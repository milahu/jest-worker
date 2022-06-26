'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});
exports.default = void 0;

function path() {
  const data = _interopRequireWildcard(require('path'));

  path = function () {
    return data;
  };

  return data;
}

function _mergeStream() {
  const data = _interopRequireDefault(require('merge-stream'));

  _mergeStream = function () {
    return data;
  };

  return data;
}

function _debug() {
  const data = require('../debug');

  _debug = function () {
    return data;
  };

  return data;
}

function _types() {
  const data = require('../types');

  _types = function () {
    return data;
  };

  return data;
}

function _interopRequireDefault(obj) {
  return obj && obj.__esModule ? obj : {default: obj};
}

function _getRequireWildcardCache() {
  if (typeof WeakMap !== 'function') return null;
  var cache = new WeakMap();
  _getRequireWildcardCache = function () {
    return cache;
  };
  return cache;
}

function _interopRequireWildcard(obj) {
  if (obj && obj.__esModule) {
    return obj;
  }
  if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) {
    return {default: obj};
  }
  var cache = _getRequireWildcardCache();
  if (cache && cache.has(obj)) {
    return cache.get(obj);
  }
  var newObj = {};
  var hasPropertyDescriptor =
    Object.defineProperty && Object.getOwnPropertyDescriptor;
  for (var key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      var desc = hasPropertyDescriptor
        ? Object.getOwnPropertyDescriptor(obj, key)
        : null;
      if (desc && (desc.get || desc.set)) {
        Object.defineProperty(newObj, key, desc);
      } else {
        newObj[key] = obj[key];
      }
    }
  }
  newObj.default = obj;
  if (cache) {
    cache.set(obj, newObj);
  }
  return newObj;
}

function _defineProperty(obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  } else {
    obj[key] = value;
  }
  return obj;
}

// How long to wait for the child process to terminate
// after CHILD_MESSAGE_END before sending force exiting.
const FORCE_EXIT_DELAY = 500;
/* istanbul ignore next */

const emptyMethod = () => {};

class BaseWorkerPool {
  constructor(workerPath, options) {
    _defineProperty(this, '_stderr', void 0);

    _defineProperty(this, '_stdout', void 0);

    _defineProperty(this, '_options', void 0);

    _defineProperty(this, '_workerPath', void 0);

    _defineProperty(this, '_workers', void 0);

    _defineProperty(this, '_workerTokens', void 0);

    this._workerPath = workerPath;
    this._options = options;

    if (!path().isAbsolute(workerPath)) {
      workerPath = require.resolve(workerPath);
    }

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
      (0, _debug().debug)(
        `BaseWorkerPool.constructor: no jobClient -> start all workers before demand`
      ); // no jobclient -> numWorkers is static
      // start all workers before demand

      for (let i = 0; i < options.numWorkers; i++) {
        this._addWorker(i);
      }
    }
  }

  _addWorker(workerId, ignoreJobClient = false) {
    (0, _debug().debug)(`BaseWorkerPool._addWorker`); // ignoreJobClient is true for the first worker with jobclient

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
      (0, _debug().debug)(
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
        [_types().CHILD_MESSAGE_END, false],
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
