const { ReadableStream, WritableStream, TransformStream } = require('node:stream/web');
const { Blob, File } = require('node:buffer');
const { MessagePort, MessageChannel } = require('node:worker_threads');

if (typeof globalThis.ReadableStream === 'undefined') {
  globalThis.ReadableStream = ReadableStream;
  globalThis.WritableStream = WritableStream;
  globalThis.TransformStream = TransformStream;
}
if (typeof globalThis.Blob === 'undefined') {
  globalThis.Blob = Blob;
}
if (typeof globalThis.File === 'undefined' && File) {
  globalThis.File = File;
}
if (typeof globalThis.MessagePort === 'undefined') {
  globalThis.MessagePort = MessagePort;
  globalThis.MessageChannel = MessageChannel;
}
if (typeof globalThis.DOMException === 'undefined') {
  globalThis.DOMException = global.DOMException || class DOMException extends Error {};
}



