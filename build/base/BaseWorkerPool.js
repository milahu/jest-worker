'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});
exports.default = void 0;

function _mergeStream() {
  const data = _interopRequireDefault(require('merge-stream'));

  _mergeStream = function () {
    return data;
  };

  return data;
}

var _debug = require('../debug');

var _types = require('../types');

function _interopRequireDefault(obj) {
  return obj && obj.__esModule ? obj : {default: obj};
}

/**
 * Copyright (c) Facebook, Inc. and its affiliates. All Rights Reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// How long to wait for the child process to terminate
// after CHILD_MESSAGE_END before sending force exiting.
const FORCE_EXIT_DELAY = 500;
/* istanbul ignore next */
// eslint-disable-next-line @typescript-eslint/no-empty-function

const emptyMethod = () => {};

class BaseWorkerPool {
  _stderr;
  _stdout;
  _options;
  _workerPath;
  _workers;
  _workerTokens;

  constructor(workerPath, options) {
    this._workerPath = workerPath;
    this._options = options;
    this._stdout = (0, _mergeStream().default)();
    this._stderr = (0, _mergeStream().default)();

    if (options.jobClient) {
      // with jobClient, override numWorkers
      // NOTE maxJobs is upper bound. minJobs is 1
      options.numWorkers = options.jobClient.maxJobs;
    }

    this._workers = new Array(options.numWorkers);
    this._workerTokens = new Array(options.numWorkers);

    if (options.jobClient) {
      // start 1 worker, grow on demand
      this._addWorker(0, true);
    } else {
      (0, _debug.debug)(
        `BaseWorkerPool.constructor: no jobClient -> start all workers before demand`
      ); // no jobclient -> numWorkers is static
      // start all workers before demand

      for (let i = 0; i < options.numWorkers; i++) {
        this._addWorker(i);
      }
    }
  }

  _addWorker(workerId, ignoreJobClient = false) {
    (0, _debug.debug)(`BaseWorkerPool._addWorker`); // ignoreJobClient is true for the first worker with jobclient

    if (this._workers[workerId]) return this._workers[workerId];

    if (this._options.jobClient && !ignoreJobClient) {
      const numWorkers = this._workers.filter(Boolean).length;

      if (numWorkers > 0) {
        const token = this._options.jobClient.acquire();

        if (token == null) {
          return null; // jobserver is full, try again later
        }

        this._workerTokens[workerId] = token;
      } // else: dont acquire token for the first worker
    }

    const {forkOptions, maxRetries, resourceLimits, setupArgs} = this._options;
    const workerOptions = {
      forkOptions,
      maxRetries,
      resourceLimits,
      setupArgs,
      workerId,
      workerPath: this._workerPath
    };
    const worker = this.createWorker(workerOptions);
    const workerStdout = worker.getStdout();
    const workerStderr = worker.getStderr();

    if (workerStdout) {
      this._stdout.add(workerStdout);
    }

    if (workerStderr) {
      this._stderr.add(workerStderr);
    }

    this._workers[workerId] = worker;
    return worker;
  }

  getStderr() {
    return this._stderr;
  }

  getStdout() {
    return this._stdout;
  }

  getWorkers() {
    return this._workers;
  }

  getWorkerById(workerId) {
    if (this._options.jobClient && this._workers[workerId] == undefined) {
      // try to create new worker
      (0, _debug.debug)(
        `BaseWorkerPool.getWorkerById: create worker ${workerId}`
      );
      return this._addWorker(workerId);
    }

    return this._workers[workerId];
  }

  createWorker(_workerOptions) {
    throw Error('Missing method createWorker in WorkerPool');
  }

  async end() {
    // We do not cache the request object here. If so, it would only be only
    // processed by one of the workers, and we want them all to close.
    const workerExitPromises = this._workers.map(async (worker, workerId) => {
      if (!worker) return false;
      worker.send(
        [_types.CHILD_MESSAGE_END, false],
        emptyMethod,
        emptyMethod,
        emptyMethod
      ); // Schedule a force exit in case worker fails to exit gracefully so
      // await worker.waitForExit() never takes longer than FORCE_EXIT_DELAY

      let forceExited = false;
      const forceExitTimeout = setTimeout(() => {
        worker.forceExit();
        forceExited = true;
      }, FORCE_EXIT_DELAY);
      await worker.waitForExit(); // Worker ideally exited gracefully, don't send force exit then

      clearTimeout(forceExitTimeout);

      if (this._options.jobClient) {
        const token = this._workerTokens[workerId];

        if (token != undefined) {
          this._options.jobClient.release(token);

          this._workerTokens[workerId] = undefined;
        }
      }

      return forceExited;
    });

    const workerExits = await Promise.all(workerExitPromises);
    return workerExits.reduce(
      (result, forceExited) => ({
        forceExited: result.forceExited || forceExited
      }),
      {
        forceExited: false
      }
    );
  }
}

exports.default = BaseWorkerPool;
