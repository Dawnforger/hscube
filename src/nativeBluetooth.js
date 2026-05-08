import { Capacitor } from "@capacitor/core";
import { BleClient } from "@capacitor-community/bluetooth-le";

let bleInitialized = false;
let preferredNativeDeviceId = null;
let preferredDevicePickerSuppressed = false;
let preferredNativeDeviceName = null;
let preferredCubeMac = null;
let lastResolvedNativeDeviceId = null;
const AUTO_CONNECT_SCAN_TIMEOUT_MS = 4500;
const GAN_GEN2_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dc4179";
const GAN_GEN3_SERVICE_UUID = "8653000a-43e6-47b7-9cb0-5fc21d4ae340";
const GAN_GEN4_SERVICE_UUID = "00000010-0000-fff7-fff6-fff5fff4fff0";

export function setNativePreferredDevice(deviceId, options = {}) {
  preferredNativeDeviceId = typeof deviceId === "string" && deviceId ? deviceId : null;
  preferredDevicePickerSuppressed = Boolean(options?.suppressPickerOnFailure);
  preferredNativeDeviceName =
    typeof options?.deviceName === "string" && options.deviceName.trim()
      ? options.deviceName.trim()
      : null;
  preferredCubeMac =
    typeof options?.deviceMac === "string" && options.deviceMac.trim()
      ? options.deviceMac.trim()
      : null;
}

export function getLastResolvedNativeDeviceId() {
  return lastResolvedNativeDeviceId;
}

export function clearNativePreferredDevice() {
  preferredNativeDeviceId = null;
  preferredDevicePickerSuppressed = false;
  preferredNativeDeviceName = null;
  preferredCubeMac = null;
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
    const knownDevice = await resolvePreferredNativeDevice().catch(() => null);
    if (knownDevice?.deviceId) {
      preferredNativeDeviceId = knownDevice.deviceId;
      lastResolvedNativeDeviceId = knownDevice.deviceId;
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
  lastResolvedNativeDeviceId = bleDevice.deviceId;
  preferredDevicePickerSuppressed = false;
  return new NativeBluetoothDevice(bleDevice.deviceId, bleDevice.name ?? "Unknown cube");
}

async function resolvePreferredNativeDevice() {
  const preferredCandidates = buildPreferredDeviceIdCandidates(preferredNativeDeviceId);
  const nameHint = normalizeName(preferredNativeDeviceName);
  const macHint = normalizeMac(preferredCubeMac);

  const connectedDevices = await BleClient.getConnectedDevices([]).catch(() => ({ devices: [] }));
  const connectedMatch = findBestPreferredDevice(connectedDevices?.devices ?? [], {
    preferredCandidates,
    nameHint,
    macHint,
  });
  if (connectedMatch) {
    return connectedMatch;
  }

  const bondedDevices = await BleClient.getBondedDevices().catch(() => ({ devices: [] }));
  const bondedList = bondedDevices?.devices ?? [];
  const bondedMatch = findBestPreferredDevice(bondedList, {
    preferredCandidates,
    nameHint,
    macHint,
  });
  if (bondedMatch) {
    return bondedMatch;
  }

  const scannedMatch = await discoverPreferredDeviceViaScan({
    preferredCandidates,
    nameHint,
    macHint,
    timeoutMs: AUTO_CONNECT_SCAN_TIMEOUT_MS,
  }).catch(() => null);
  if (scannedMatch) {
    return scannedMatch;
  }

  const fallbackKnown = await BleClient.getDevices({
    deviceIds: preferredCandidates,
  }).catch(() => ({ devices: [] }));
  const fallbackMatch = findBestPreferredDevice(fallbackKnown?.devices ?? [], {
    preferredCandidates,
    nameHint,
    macHint,
    allowIdOnlyMatch: true,
  });
  return fallbackMatch;
}

async function discoverPreferredDeviceViaScan(options = {}) {
  const { preferredCandidates = [], nameHint = null, macHint = null, timeoutMs = 4000 } = options;
  const deadlineMs = Math.max(1800, Math.round(timeoutMs));
  const start = Date.now();
  let best = null;
  let scanError = null;

  try {
    await BleClient.requestLEScan(
      {
        namePrefix: "GAN",
        optionalServices: [GAN_GEN2_SERVICE_UUID, GAN_GEN3_SERVICE_UUID, GAN_GEN4_SERVICE_UUID],
      },
      (scanResult) => {
        const candidate = extractBleDeviceFromScanResult(scanResult);
        if (!candidate) {
          return;
        }
        if (!isCandidateRelevant(candidate, preferredCandidates, nameHint, macHint)) {
          return;
        }
        best = candidate;
      },
    );
  } catch (error) {
    scanError = error;
  }

  while (!best && Date.now() - start < deadlineMs) {
    await delay(200);
  }

  await BleClient.stopLEScan().catch(() => undefined);
  if (best) {
    return best;
  }
  if (scanError) {
    throw scanError;
  }
  return null;
}

function extractBleDeviceFromScanResult(scanResult) {
  if (!scanResult || typeof scanResult !== "object") {
    return null;
  }
  if (scanResult.device && typeof scanResult.device === "object") {
    return scanResult.device;
  }
  if (scanResult.deviceId) {
    return {
      deviceId: scanResult.deviceId,
      name: typeof scanResult.localName === "string" ? scanResult.localName : undefined,
    };
  }
  return null;
}

function findBestPreferredDevice(devices, options = {}) {
  const {
    preferredCandidates = [],
    nameHint = null,
    macHint = null,
    allowIdOnlyMatch = false,
  } = options;
  const list = Array.isArray(devices) ? devices.filter((entry) => Boolean(entry?.deviceId)) : [];
  if (!list.length) {
    return null;
  }

  const exactIdMatch = list.find((entry) => matchesPreferredId(entry.deviceId, preferredCandidates));
  if (exactIdMatch) {
    return exactIdMatch;
  }

  if (macHint) {
    const macMatch = list.find((entry) => normalizeMac(entry.deviceId) === macHint);
    if (macMatch) {
      return macMatch;
    }
  }

  if (nameHint) {
    const nameMatch = list.find((entry) => normalizeName(entry.name) === nameHint);
    if (nameMatch) {
      return nameMatch;
    }
  }

  const singleGanCandidate = list.filter((entry) => isGanLikeName(entry.name));
  if (singleGanCandidate.length === 1 && (nameHint || macHint)) {
    return singleGanCandidate[0];
  }

  if (allowIdOnlyMatch) {
    return list[0];
  }

  return null;
}

function isCandidateRelevant(candidate, preferredCandidates, nameHint, macHint) {
  if (!candidate?.deviceId) {
    return false;
  }
  if (matchesPreferredId(candidate.deviceId, preferredCandidates)) {
    return true;
  }
  if (macHint && normalizeMac(candidate.deviceId) === macHint) {
    return true;
  }
  if (nameHint && normalizeName(candidate.name) === nameHint) {
    return true;
  }
  return false;
}

function matchesPreferredId(deviceId, preferredCandidates = []) {
  const normalizedDeviceId = normalizeId(deviceId);
  if (!normalizedDeviceId) {
    return false;
  }
  return preferredCandidates.some((candidate) => normalizeId(candidate) === normalizedDeviceId);
}

function normalizeId(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
}

function normalizeName(value) {
  if (typeof value !== "string") {
    return null;
  }
  const next = value.trim().toLowerCase();
  return next || null;
}

function normalizeMac(value) {
  if (typeof value !== "string") {
    return null;
  }
  const compact = value.trim().replace(/[^a-fA-F0-9]/g, "").toUpperCase();
  if (compact.length !== 12) {
    return null;
  }
  return compact;
}

function isGanLikeName(value) {
  if (typeof value !== "string") {
    return false;
  }
  const name = value.trim().toUpperCase();
  return name.startsWith("GAN") || name.startsWith("MG") || name.startsWith("AICUBE");
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function buildPreferredDeviceIdCandidates(deviceId) {
  const raw = String(deviceId ?? "").trim();
  if (!raw) {
    return [];
  }
  const candidates = [raw, raw.toUpperCase(), raw.toLowerCase()];
  if (isLikelyMacAddress(raw)) {
    const normalized = raw.replace(/-/g, ":").toUpperCase();
    const compact = normalized.replace(/:/g, "");
    candidates.push(normalized, compact, compact.toLowerCase());
  }
  return unique(candidates);
}

function isLikelyMacAddress(value) {
  return /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(String(value ?? "").trim());
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
