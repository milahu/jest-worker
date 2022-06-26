'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});
exports.default = void 0;

var _FifoQueue = _interopRequireDefault(require('./FifoQueue'));

var _debug = require('./debug');

var _types = require('./types');

function _interopRequireDefault(obj) {
  return obj && obj.__esModule ? obj : {default: obj};
}

/**
 * Copyright (c) Facebook, Inc. and its affiliates. All Rights Reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class Farm {
  _computeWorkerKey;
  _workerSchedulingPolicy;
  _cacheKeys = Object.create(null);
  _locks = [];
  _offset = 0;
  _taskQueue;

  constructor( // TODO rename to _numWorkers
    _numOfWorkers, // workerPool.send. TODO rename to _sendToWorkerPool
    _callback,
    options = {}
  ) {
    var _options$workerSchedu, _options$taskQueue;

    this._numOfWorkers = _numOfWorkers;
    this._callback = _callback;
    (0, _debug.debug)(`Farm.constructor: _numOfWorkers = ${_numOfWorkers}`); //this._numOfWorkers = _numOfWorkers;

    this._computeWorkerKey = options.computeWorkerKey;
    this._workerSchedulingPolicy =
      (_options$workerSchedu = options.workerSchedulingPolicy) !== null &&
      _options$workerSchedu !== void 0
        ? _options$workerSchedu
        : 'round-robin';
    this._taskQueue =
      (_options$taskQueue = options.taskQueue) !== null &&
      _options$taskQueue !== void 0
        ? _options$taskQueue
        : new _FifoQueue.default();
  }

  doWork(method, ...args) {
    (0, _debug.debug)('');
    (0, _debug.debug)(`Farm.doWork: method=${method} args=${args}`);
    const customMessageListeners = new Set();

    const addCustomMessageListener = listener => {
      customMessageListeners.add(listener);
      return () => {
        customMessageListeners.delete(listener);
      };
    };

    const onCustomMessage = message => {
      customMessageListeners.forEach(listener => listener(message));
    };

    const promise = new Promise( // Bind args to this function so it won't reference to the parent scope.
      // This prevents a memory leak in v8, because otherwise the function will
      // retain args for the closure.
      ((args, resolve, reject) => {
        const computeWorkerKey = this._computeWorkerKey;
        const request = [_types.CHILD_MESSAGE_CALL, false, method, args];
        let worker = null;
        let hash = null;

        if (computeWorkerKey) {
          hash = computeWorkerKey.call(this, method, ...args);
          worker = hash == null ? null : this._cacheKeys[hash];
        }

        const onStart = worker => {
          if (hash != null) {
            this._cacheKeys[hash] = worker;
          }
        };

        const onEnd = (error, result) => {
          customMessageListeners.clear();

          if (error) {
            reject(error);
          } else {
            resolve(result);
          }
        };

        const task = {
          onCustomMessage,
          onEnd,
          onStart,
          request
        };

        if (worker) {
          (0, _debug.debug)(
            `Farm.doWork: re-use last worker -> add task to queue`
          );

          this._taskQueue.enqueue(task, worker.getWorkerId()); // try to process, fail if worker is blocked

          this._process(worker.getWorkerId());
        } else {
          (0, _debug.debug)(`Farm.doWork: use any worker -> call push`);

          this._push(task);
        }
      }).bind(null, args)
    );
    promise.UNSTABLE_onCustomMessage = addCustomMessageListener;
    return promise;
  }

  _process(workerId) {
    if (this._isLocked(workerId)) {
      (0, _debug.debug)(`Farm._process: worker ${workerId} is locked`);
      return this;
    }

    const task = this._taskQueue.dequeue(workerId);

    (0, _debug.debug)(`Farm._process: worker ${workerId}: task = ${task}`);

    if (!task) {
      return this;
    }

    if (task.request[1]) {
      throw new Error('Queue implementation returned processed task');
    } // Reference the task object outside so it won't be retained by onEnd,
    // and other properties of the task object, such as task.request can be
    // garbage collected.

    let taskOnEnd = task.onEnd;

    const onEnd = (error, result) => {
      if (taskOnEnd) {
        (0, _debug.debug)('');
        (0, _debug.debug)(
          `Farm._process: worker ${workerId}: onEnd: calling taskOnEnd`
        );
        taskOnEnd(error, result);
      }

      taskOnEnd = null;
      (0, _debug.debug)(
        `Farm._process: worker ${workerId}: onEnd: done. unlock worker ${workerId}`
      );

      this._unlock(workerId);

      this._process(workerId);
    };

    (0, _debug.debug)(
      `Farm._process: worker ${workerId}: lock worker ${workerId}`
    );

    this._lock(workerId);

    (0, _debug.debug)(
      `Farm._process: worker ${workerId}: send task to worker ...`
    );
    task.request[1] = this._callback(
      workerId,
      task.request,
      task.onStart,
      onEnd,
      task.onCustomMessage
    );

    if (task.request[1] == false) {
      // task was not sent to worker
      this._unlock(workerId);
    }

    (0, _debug.debug)(
      `Farm._process: worker ${workerId}: send task to worker ... ${
        task.request[1] ? 'ok' : 'fail'
      }`
    );
    return this;
  }

  _push(task) {
    (0, _debug.debug)(`Farm._push: add task ${task}`);

    this._taskQueue.enqueue(task); // no worker id -> any worker

    const offset = this._getNextWorkerOffset();

    (0, _debug.debug)(`Farm._push: offset = ${offset}`);
    (0, _debug.debug)(`Farm._push: find worker for task ${task}`);

    for (let i = 0; i < this._numOfWorkers; i++) {
      const workerId = (offset + i) % this._numOfWorkers;
      (0, _debug.debug)(`Farm._push: process worker ${workerId}`);

      this._process(workerId);

      (0, _debug.debug)(`Farm._push: task.request[1] = ${task.request[1]}`);

      if (task.request[1]) {
        // found worker
        break;
      }
    }

    return this;
  }

  _getNextWorkerOffset() {
    switch (this._workerSchedulingPolicy) {
      case 'in-order':
        return 0;

      case 'round-robin':
        // note: this counts to infinity
        return this._offset++;
    }
  }

  _lock(workerId) {
    this._locks[workerId] = true;
  }

  _unlock(workerId) {
    this._locks[workerId] = false;
  }

  _isLocked(workerId) {
    return this._locks[workerId];
  }
}

exports.default = Farm;
