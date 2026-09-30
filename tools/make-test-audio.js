// Generates a short WAV test file: 8 beeps (counts 1-8), one per second, for manual testing.
const fs = require('fs');
const path = require('path');

const sampleRate = 44100;
const seconds = 8;
const numSamples = sampleRate * seconds;
const data = new Float32Array(numSamples);

for (let beat = 0; beat < 8; beat++) {
  const startSample = beat * sampleRate;
  const freq = 440 + beat * 40;
  const beepLen = Math.floor(sampleRate * 0.15);
  for (let i = 0; i < beepLen; i++) {
    const t = i / sampleRate;
    const envelope = Math.sin((Math.PI * i) / beepLen);
    data[startSample + i] = Math.sin(2 * Math.PI * freq * t) * envelope * 0.6;
  }
}

function encodeWav(samples, sampleRate) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buffer;
}

const outPath = path.join(__dirname, '..', 'test-assets', 'count-test.wav');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, encodeWav(data, sampleRate));
console.log('wrote', outPath);
