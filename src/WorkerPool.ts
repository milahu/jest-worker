/**
 * Copyright (c) Facebook, Inc. and its affiliates. All Rights Reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import BaseWorkerPool from './base/BaseWorkerPool';
import {debug} from './debug';
import type {
  ChildMessage,
  OnCustomMessage,
  OnEnd,
  OnStart,
  WorkerInterface,
  WorkerOptions,
  WorkerPoolInterface,
} from './types';

const canUseWorkerThreads = () => {
  try {
    require('worker_threads');
    return true;
  } catch {
    return false;
  }
};

class WorkerPool extends BaseWorkerPool implements WorkerPoolInterface {
  send(
    workerId: number,
    request: ChildMessage,
    onStart: OnStart,
    onEnd: OnEnd,
    onCustomMessage: OnCustomMessage,
  ): boolean {
    const worker = this.getWorkerById(workerId);
    debug(`WorkerPool.send: workerId=${workerId} worker=${worker}`)
    if (worker == null) return false;
    worker.send(request, onStart, onEnd, onCustomMessage);
    return true;
  }

  createWorker(workerOptions: WorkerOptions): WorkerInterface {
    let Worker;
    if (this._options.enableWorkerThreads && canUseWorkerThreads()) {
      Worker = require('./workers/NodeThreadsWorker').default;
    } else {
      Worker = require('./workers/ChildProcessWorker').default;
    }

    return new Worker(workerOptions);
  }
}

export default WorkerPool;
