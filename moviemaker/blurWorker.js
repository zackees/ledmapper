importScripts('blurWorkerContext.js');

// Worker code


onmessage = function(e) {
    console.log('Message received from main script');
    const workerResult = 'Result from worker: ' + e.data;
    console.log('Posting message back to main script');
    postMessage(workerResult);
};

function blur(context) {
    
    
}

class WorkerContext {
    postMessage(data, transfer) {
        self.postMessage(data, transfer);
    }
}

class BlurWorkerContext extends WorkerContext {
    constructor() {
        super();
    }

    onmessage(event) {
        const context = event.data.context;
        if (!context instanceof BlurContext) {
            throw new Error('Invalid context');s
        }
        blur(context);
        this.postMessage(context);
    }
}

const context = new BlurWorkerContext();
self.onmessage = context.onmessage.bind(context);
