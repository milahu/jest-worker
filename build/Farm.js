'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});
exports.default = void 0;

var _debug = require('./debug');

var _types = require('./types');

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

class Farm {
  constructor(numOfWorkers, callback, computeWorkerKey) {
    _defineProperty(this, '_computeWorkerKey', void 0);

    _defineProperty(this, '_cacheKeys', void 0);

    _defineProperty(this, '_callback', void 0);

    _defineProperty(this, '_last', void 0);

    _defineProperty(this, '_locks', void 0);

    _defineProperty(this, '_numOfWorkers', void 0);

    _defineProperty(this, '_offset', void 0);

    _defineProperty(this, '_queue', void 0);

    this._cacheKeys = Object.create(null);
    this._callback = callback;
    this._last = [];
    this._locks = [];
    this._numOfWorkers = numOfWorkers;
    this._offset = 0;
    this._queue = [];
    (0, _debug.debug)(`Farm.constructor: numOfWorkers = ${numOfWorkers}`);

    if (computeWorkerKey) {
      this._computeWorkerKey = computeWorkerKey;
    }
  }

  doWork(method, ...args) {
    (0, _debug.debug)('');
    (0, _debug.debug)(`Farm.doWork: method=${method}`); // args is too verbose

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

    const promise = new Promise((resolve, reject) => {
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

        this._enqueue(task, worker.getWorkerId());
      } else {
        (0, _debug.debug)(`Farm.doWork: use any worker -> call push`);

        this._push(task);
      }
    });
    promise.UNSTABLE_onCustomMessage = addCustomMessageListener;
    return promise;
  }

  _getNextTask(workerId) {
    let queueHead = this._queue[workerId];

    while (queueHead && queueHead.task.request[1]) {
      queueHead = queueHead.next || null;
    }

    this._queue[workerId] = queueHead;
    return queueHead && queueHead.task;
  }

  _process(workerId) {
    if (this._isLocked(workerId)) {
      (0, _debug.debug)(`Farm._process: worker ${workerId} is locked`);
      return this;
    }

    const task = this._getNextTask(workerId);

    (0, _debug.debug)(`Farm._process: worker ${workerId}: task = ${task}`);

    if (!task) {
      return this;
    }

    const onEnd = (error, result) => {
      task.onEnd(error, result);
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

  _enqueue(task, workerId) {
    const item = {
      next: null,
      task
    };

    if (task.request[1]) {
      return this;
    }

    if (this._queue[workerId]) {
      this._last[workerId].next = item;
    } else {
      this._queue[workerId] = item;
    }

    this._last[workerId] = item;

    this._process(workerId);

    return this;
  }

  _push(task) {
    for (let i = 0; i < this._numOfWorkers; i++) {
      this._enqueue(task, (this._offset + i) % this._numOfWorkers);
    }

    this._offset++;
    return this;
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
