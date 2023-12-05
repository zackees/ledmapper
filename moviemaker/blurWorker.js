importScripts('blurWorkerContext.js');

// Worker code

onmessage = function(e) {

    console.log('Message received from main script');
    const workerResult = 'Result from worker: ' + e.data;
    console.log('Posting message back to main script');
    postMessage(workerResult);
};