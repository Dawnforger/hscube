import { Capacitor } from "@capacitor/core";
import { BleClient } from "@capacitor-community/bluetooth-le";

let bleInitialized = false;
let preferredNativeDeviceId = null;
let preferredDevicePickerSuppressed = false;
const GAN_GEN2_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dc4179";
const GAN_GEN3_SERVICE_UUID = "8653000a-43e6-47b7-9cb0-5fc21d4ae340";
const GAN_GEN4_SERVICE_UUID = "00000010-0000-fff7-fff6-fff5fff4fff0";

export function setNativePreferredDevice(deviceId, options = {}) {
  preferredNativeDeviceId = typeof deviceId === "string" && deviceId ? deviceId : null;
  preferredDevicePickerSuppressed = Boolean(options?.suppressPickerOnFailure);
}

export function clearNativePreferredDevice() {
  preferredNativeDeviceId = null;
  preferredDevicePickerSuppressed = false;
}

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

  if (preferredNativeDeviceId) {
    const maybeKnown = await BleClient.getDevices({
      deviceIds: [preferredNativeDeviceId],
    }).catch(() => ({ devices: [] }));
    const knownDevice = maybeKnown?.devices?.[0];
    if (knownDevice?.deviceId) {
      preferredDevicePickerSuppressed = false;
      return new NativeBluetoothDevice(
        knownDevice.deviceId,
        knownDevice.name ?? "Known cube",
      );
    }

    if (preferredDevicePickerSuppressed) {
      throw new Error("Preferred device unavailable for auto-connect.");
    }
  }

  const requestOptions = toBleRequestOptions(options);
  let bleDevice;
  try {
    bleDevice = await BleClient.requestDevice(requestOptions);
  } catch (error) {
    const message = String(error ?? "").toLowerCase();
    const shouldRetry =
      message.includes("no device found") ||
      message.includes("notfounderror") ||
      message.includes("scan");

    if (!shouldRetry) {
      throw error;
    }

    // Some GAN devices do not advertise every service during scan.
    // Fall back to prefix-only filtering before giving up.
    bleDevice = await BleClient.requestDevice({
      namePrefix: "GAN",
      optionalServices: [
        GAN_GEN2_SERVICE_UUID,
        GAN_GEN3_SERVICE_UUID,
        GAN_GEN4_SERVICE_UUID,
      ],
    });
  }

  preferredNativeDeviceId = bleDevice.deviceId;
  preferredDevicePickerSuppressed = false;
  return new NativeBluetoothDevice(bleDevice.deviceId, bleDevice.name ?? "Unknown cube");
}

function toBleRequestOptions(options) {
  // This app targets GAN cubes. Keeping a strict filter prevents the picker
  // from being cluttered with unrelated BLE peripherals and reduces bad picks.
  const defaults = {
    namePrefix: "GAN",
    optionalServices: [
      GAN_GEN2_SERVICE_UUID,
      GAN_GEN3_SERVICE_UUID,
      GAN_GEN4_SERVICE_UUID,
    ],
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

  const selectedServices = Array.isArray(filter.services)
    ? filter.services.map((service) => normalizeUuid(service))
    : [];
  if (selectedServices.length > 0) {
    bleOptions.services = selectedServices;
  }

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

  const mgByPrefix = filters.find(
    (filter) =>
      typeof filter?.namePrefix === "string" &&
      filter.namePrefix.toUpperCase().startsWith("MG"),
  );
  if (mgByPrefix) {
    return mgByPrefix;
  }

  const aiCubeByPrefix = filters.find(
    (filter) =>
      typeof filter?.namePrefix === "string" &&
      filter.namePrefix.toUpperCase().startsWith("AICUBE"),
  );
  if (aiCubeByPrefix) {
    return aiCubeByPrefix;
  }

  return filters[0];
}

class NativeBluetoothDevice extends EventTarget {
  constructor(deviceId, name) {
    super();
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
    this.serviceDefinitions = null;
  }

  async connect() {
    if (this.connected) {
      return this;
    }

    // Some Android stacks keep stale connections, so clear first.
    await BleClient.disconnect(this.device.id).catch(() => undefined);
    await BleClient.connect(this.device.id, () => {
      this.connected = false;
      this.device.dispatchEvent(new Event("gattserverdisconnected"));
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
    this.device.dispatchEvent(new Event("gattserverdisconnected"));
  }

  async getPrimaryServices() {
    const definitions = await this.ensureServiceDefinitions();
    return definitions.map((definition) => this.createService(definition));
  }

  async getPrimaryService(serviceUuid) {
    const definitions = await this.ensureServiceDefinitions();
    const normalizedServiceUuid = normalizeUuid(serviceUuid);
    const match = definitions.find((definition) => definition.uuid === normalizedServiceUuid);
    if (!match) {
      throw new Error(`Service not found: ${normalizedServiceUuid}`);
    }
    return this.createService(match);
  }

  async ensureServiceDefinitions() {
    if (this.serviceDefinitions) {
      return this.serviceDefinitions;
    }

    const services = await BleClient.getServices(this.device.id);
    this.serviceDefinitions = services.map((service) => ({
      uuid: normalizeUuid(service.uuid),
      characteristics: new Set(
        (service.characteristics ?? []).map((characteristic) =>
          normalizeUuid(characteristic.uuid),
        ),
      ),
    }));

    return this.serviceDefinitions;
  }

  createService(definition) {
    if (!this.services.has(definition.uuid)) {
      this.services.set(
        definition.uuid,
        new NativeBluetoothRemoteGattService(
          this,
          definition.uuid,
          definition.characteristics,
        ),
      );
    }

    return this.services.get(definition.uuid);
  }
}

class NativeBluetoothRemoteGattService {
  constructor(server, uuid, availableCharacteristics) {
    this.server = server;
    this.uuid = uuid;
    this.availableCharacteristics = availableCharacteristics ?? null;
    this.characteristics = new Map();
  }

  async getCharacteristic(characteristicUuid) {
    const normalizedCharacteristicUuid = normalizeUuid(characteristicUuid);
    if (
      this.availableCharacteristics &&
      !this.availableCharacteristics.has(normalizedCharacteristicUuid)
    ) {
      throw new Error(`Characteristic not found: ${normalizedCharacteristicUuid}`);
    }

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
