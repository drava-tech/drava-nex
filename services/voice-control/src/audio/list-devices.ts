/** `pnpm devices` — print the input/output devices and which ones config picks. */
import { PvRecorder } from "@picovoice/pvrecorder-node";
import { PvSpeaker } from "@picovoice/pvspeaker-node";
import { loadConfig } from "../config/config.js";
import { pickDevice } from "./devices.js";

const config = loadConfig();
const inputs = PvRecorder.getAvailableDevices();
const outputs = PvSpeaker.getAvailableDevices();

console.log("Input devices:");
inputs.forEach((d, i) => console.log(`  [${i}] ${d}`));
console.log("Output devices:");
outputs.forEach((d, i) => console.log(`  [${i}] ${d}`));
console.log(`\nSelected mic:     ${pickDevice(inputs, config.audio.inputDevicePreference).name}`);
console.log(`Selected speaker: ${pickDevice(outputs, config.audio.outputDevicePreference).name}`);
