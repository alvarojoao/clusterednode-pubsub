var http2         = require('http2'),
    fs            = require('fs'),
    tls           = require('tls'),
    Redis         = require('ioredis'),
    calculateSlot = require('cluster-key-slot'),
    ioR           = require('socket.io'),
    ioN           = require('socket.io'),
    debounceTime  = 1000,
    cluster       = new Redis.Cluster(
        [
            {port: 6379, host: "192.168.69.246"},
            {port: 6378, host: "192.168.69.246"},
            {port: 6377, host: "192.168.69.246"},
            {port: 6379, host: "192.168.69.245"},
            {port: 6378, host: "192.168.69.245"},
            {port: 6377, host: "192.168.69.245"}
        ],
        {
            enableReadyCheck:        true,
            maxRedirections:         6,
            retryDelayOnFailover:    1000,
            retryDelayOnClusterDown: 1000,
            scaleReads:              'all',
            redisOptions:            {
                connectionName:         'clusteredPUBSUBnode',
                parser:                 'hiredis',
                dropBufferSupport:      true,
                prefix:                 'cn:',
                showFriendlyErrorStack: true
            }
        }
    ),
    serverRedis   = http2.createServer({
                                           key:  fs.readFileSync('./nginx-selfsigned.key'),
                                           cert: fs.readFileSync('./nginx-selfsigned.crt')
                                       });
//
// Listen to redis changes and notify
//
var debounceRedis = {};
var sioRedis = ioR.listen(serverRedis);
sioRedis.on('connection', function(socket) {
    console.log('Client connected to clusteredPUBSUBnode (redis) socket:' + socket.id);
});
serverRedis.listen(process.env.NODEPORT_HTTPREDIS, process.env.NODEIP);
cluster.on('message', function(channel, message) {
    var idx = 'm' + message,
        db  = debounceRedis[idx] || false;
    if (!db) {
        debounceRedis[idx] = true;
        sioRedis.volatile.emit('redis', {
            x: (message / 1024) | 0,
            y: message % 32,
            h: (calculateSlot('cn:' + message) / 5462) | 0
        });
        setTimeout(function() {
            debounceRedis[idx] = false;
        }, debounceTime);
    }
});
cluster.subscribe('__keyevent@0__:hset', function() {
    console.log('clusteredPUBSUBnode subscribed to redis live events stream');
});
//
// Listen to node executions and notify
//
var debounceNode = {};
var nodeClients = {};
var mapCPU = {
    raspberrypi2: {
        h:   0,
        pAr: [0,
              0,
              0,
              0],
        p:   {}
    },
    raspberrypi3: {
        h:   1,
        pAr: [0,
              0,
              0,
              0],
        p:   {}
    },
    raspberrypi5: {
        h:   2,
        pAr: [0,
              0,
              0,
              0],
        p:   {}
    },
    raspberrypi6: {
        h:   3,
        pAr: [0,
              0,
              0,
              0],
        p:   {}
    }
};
//
// start listening on NODE port to receive node calls notifications
//
var sioNode = ioN.listen(process.env.NODEPORT_HTTPNODE);
//
// on each socket connection from a nodeworker2 process
//
sioNode.on('connection', function(socket) {
    console.log('Client connected to clusteredPUBSUBnode (node) socket:' + socket.id);
    //
    // receive register data from new connection from nodeworker2
    //
    socket.on('register', function(data) {
        console.log('Nodeworker2 registered info: ' + JSON.stringify(data));
        nodeClients[socket.id] = data;
        mapCPU[data.h].pAr[mapCPU[data.h].pAr.indexOf(0)] = data.p;
        mapCPU[data.h].p['p' + data.p] = {
            pIdx: mapCPU[data.h].pAr.indexOf(data.p),
            db:   false
        };
    });
    //
    // unregister nodeworker2 that disconnected
    //
    socket.on('disconnect', function() {
        console.log('Nodeworker2 ' + nodeClients[socket.id] + ' disconnected');
        if (nodeClients[socket.id] !== undefined) {
            var hStr = nodeClients[socket.id].h,
                pStr = 'p' + nodeClients[socket.id].p;
            mapCPU[hStr].pAr[mapCPU[hStr].p[pStr]] = 0;
            delete mapCPU[hStr].p[pStr];
            delete nodeClients[socket.id];
        }
    });
    //
    // receive nodeworker2 notification and debounce/dispatch a new message to app.simulator.js
    //
    socket.on('nodecall', function(data) {
        var hIdx = data.h,
            pIdx = 'p' + data.p;
        if (!mapCPU[hIdx].p[pIdx].db) {
            mapCPU[hIdx].p[pIdx].db = true;
            sioRedis.volatile.emit('node', {
                h: mapCPU[hIdx].h,
                p: mapCPU[hIdx].p[pIdx].pIdx
            });
            setTimeout(function() {
                mapCPU[hIdx].p[pIdx].db = false;
            }, debounceTime);
        }
    });
});
//
// Graceful shutdown
//
process.on('SIGINT', function() {
    sioRedis.close();
    serverRedis.close();
    sioNode.close();
    console.log('clusteredPUBSUBnode HTTPS servers (redis/node) closed');
    cluster.pipeline().unsubscribe('__keyevent@0__:hset').quit().exec();
    console.log('clusteredPUBSUBnode redis connection closed');
    setTimeout(function() { process.exit(0); }, 500);
});
