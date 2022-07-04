import * as process from 'process';

export const debug = process.env.DEBUG_JEST_WORKER
  ? (msg: string) => console.log(`debug jest-worker ${process.pid} ${new Date().toLocaleString('af')}.${String(Date.now() % 1000).padStart(3, '0')}: ${msg}`)
  : (_msg: string) => {};
