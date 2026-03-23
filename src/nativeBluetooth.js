import { Capacitor } from "@capacitor/core";
import { BleClient } from "@capacitor-community/bluetooth-le";

let bleInitialized = false;
const GAN_CUBE_SERVICE_UUID = "0000fff0-0000-1000-8000-00805f9b34fb";
const GAN_INFO_SERVICE_UUID = "0000180a-0000-1000-8000-00805f9b34fb";

export async function installNativeBluetoothShimIfNeeded() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") {
    return false;
  }

  if (navigator.bluetooth?.__ganNativeShim === true) {
    return true;
  }

  const shim = {
    __ganNativeShim: true,
    requestDevice: async (options) => requestDevice(options),
  };

  try {
    navigator.bluetooth = shim;
  } catch {
    Object.defineProperty(navigator, "bluetooth", {
      configurable: true,
      value: shim,
    });
  }

  return true;
}

async function ensureBleInitialized() {
  if (bleInitialized) {
    return;
  }

  await BleClient.initialize();
  bleInitialized = true;
}

async function requestDevice(options = {}) {
  await ensureBleInitialized();

  const requestOptions = toBleRequestOptions(options);
  const bleDevice = await BleClient.requestDevice(requestOptions);

  return new NativeBluetoothDevice(bleDevice.deviceId, bleDevice.name ?? "Unknown cube");
}

function toBleRequestOptions(options) {
  // This app targets GAN cubes. Keeping a strict filter prevents the picker
  // from being cluttered with unrelated BLE peripherals and reduces bad picks.
  const defaults = {
    namePrefix: "GAN",
    services: [GAN_CUBE_SERVICE_UUID],
    optionalServices: [GAN_INFO_SERVICE_UUID],
  };

  if (!options || options.acceptAllDevices) {
    return defaults;
  }

  const filters = Array.isArray(options.filters) ? options.filters : [];
  const selectedFilter = pickPreferredFilter(filters);

  if (!selectedFilter) {
    return defaults;
  }

  const bleOptions = {};
  const filter = selectedFilter;

  if (typeof filter.name === "string" && filter.name.length > 0) {
    bleOptions.name = filter.name;
  }

  if (typeof filter.namePrefix === "string" && filter.namePrefix.length > 0) {
    bleOptions.namePrefix = filter.namePrefix;
  }

  const selectedServices =
    Array.isArray(filter.services) && filter.services.length > 0
      ? filter.services.map((service) => normalizeUuid(service))
      : [];
  bleOptions.services =
    selectedServices.length > 0 ? selectedServices : [...defaults.services];

  const optionalServices = Array.isArray(options.optionalServices)
    ? options.optionalServices.map((service) => normalizeUuid(service))
    : [];

  bleOptions.optionalServices = unique([
    ...defaults.optionalServices,
    ...optionalServices,
  ]);

  return bleOptions;
}

function pickPreferredFilter(filters) {
  if (!filters.length) {
    return null;
  }

  const ganByPrefix = filters.find(
    (filter) =>
      typeof filter?.namePrefix === "string" &&
      filter.namePrefix.toUpperCase().startsWith("GAN"),
  );
  if (ganByPrefix) {
    return ganByPrefix;
  }

  const ganByName = filters.find(
    (filter) =>
      typeof filter?.name === "string" &&
      filter.name.toUpperCase().startsWith("GAN"),
  );
  if (ganByName) {
    return ganByName;
  }

  return filters[0];
}

class NativeBluetoothDevice {
  constructor(deviceId, name) {
    this.id = deviceId;
    this.name = name;
    this.gatt = new NativeBluetoothRemoteGattServer(this);
  }
}

class NativeBluetoothRemoteGattServer {
  constructor(device) {
    this.device = device;
    this.connected = false;
    this.services = new Map();
  }

  async connect() {
    if (this.connected) {
      return this;
    }

    // Some Android stacks keep stale connections, so clear first.
    await BleClient.disconnect(this.device.id).catch(() => undefined);
    await BleClient.connect(this.device.id, () => {
      this.connected = false;
    });

    this.connected = true;
    return this;
  }

  disconnect() {
    if (!this.connected) {
      return;
    }

    this.connected = false;
    void BleClient.disconnect(this.device.id).catch(() => undefined);
  }

  async getPrimaryService(serviceUuid) {
    const normalizedServiceUuid = normalizeUuid(serviceUuid);
    if (!this.services.has(normalizedServiceUuid)) {
      this.services.set(
        normalizedServiceUuid,
        new NativeBluetoothRemoteGattService(this, normalizedServiceUuid),
      );
    }
    return this.services.get(normalizedServiceUuid);
  }
}

class NativeBluetoothRemoteGattService {
  constructor(server, uuid) {
    this.server = server;
    this.uuid = uuid;
    this.characteristics = new Map();
  }

  async getCharacteristic(characteristicUuid) {
    const normalizedCharacteristicUuid = normalizeUuid(characteristicUuid);
    if (!this.characteristics.has(normalizedCharacteristicUuid)) {
      this.characteristics.set(
        normalizedCharacteristicUuid,
        new NativeBluetoothRemoteGattCharacteristic(
          this.server,
          this.uuid,
          normalizedCharacteristicUuid,
        ),
      );
    }
    return this.characteristics.get(normalizedCharacteristicUuid);
  }
}

class NativeBluetoothRemoteGattCharacteristic extends EventTarget {
  constructor(server, serviceUuid, characteristicUuid) {
    super();
    this.server = server;
    this.serviceUuid = serviceUuid;
    this.uuid = characteristicUuid;
    this.value = new DataView(new ArrayBuffer(0));
    this.notificationsStarted = false;
  }

  async readValue() {
    const data = await BleClient.read(
      this.server.device.id,
      this.serviceUuid,
      this.uuid,
    );
    this.value = data;
    return data;
  }

  async writeValue(value) {
    const dataView = toDataView(value);
    await BleClient.write(this.server.device.id, this.serviceUuid, this.uuid, dataView);
  }

  async writeValueWithResponse(value) {
    await this.writeValue(value);
  }

  async startNotifications() {
    if (this.notificationsStarted) {
      return this;
    }

    await BleClient.startNotifications(
      this.server.device.id,
      this.serviceUuid,
      this.uuid,
      (nextValue) => {
        this.value = nextValue;
        this.dispatchEvent(new Event("characteristicvaluechanged"));
      },
    );

    this.notificationsStarted = true;
    return this;
  }

  async stopNotifications() {
    if (!this.notificationsStarted) {
      return this;
    }

    await BleClient.stopNotifications(this.server.device.id, this.serviceUuid, this.uuid);
    this.notificationsStarted = false;
    return this;
  }
}

function normalizeUuid(uuid) {
  if (typeof uuid === "number") {
    const hex = uuid.toString(16).padStart(4, "0");
    return `0000${hex}-0000-1000-8000-00805f9b34fb`;
  }

  return String(uuid).toLowerCase();
}

function toDataView(value) {
  if (value instanceof DataView) {
    return value;
  }

  if (ArrayBuffer.isView(value)) {
    return new DataView(value.buffer, value.byteOffset, value.byteLength);
  }

  if (value instanceof ArrayBuffer) {
    return new DataView(value);
  }

  throw new Error("Unsupported value type for BLE write.");
}

function unique(items) {
  return [...new Set(items)];
}
