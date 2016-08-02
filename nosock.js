'use strict';
require('pmx').init({
                        http:          true, // HTTP routes logging (default: true)
                        errors:        true, // Exceptions loggin (default: true)
                        custom_probes: true, // Auto expose JS Loop Latency and HTTP req/s as custom metrics
                        network:       true, // Network monitoring at the application level
                        ports:         false // Shows which ports your app is listening on (default: false)
                    });
var http2         = require('http2'),
    fs            = require('fs'),
    tls           = require('tls'),
    Redis         = require('ioredis'),
    calculateSlot = require('cluster-key-slot'),
    ioR           = require('socket.io'),
    os            = require('os'),
    net           = os.networkInterfaces(),
//    netIf         = (net.eth1 === undefined) ? '127.0.0.1' : net.eth1[0].address,
    netIf         = '192.168.69.233',
    debounceTime  = 500,
    cluster       = new Redis.Cluster(
        [
            {port: 6379, host: "192.168.69.238"},
            {port: 6378, host: "192.168.69.238"},
            {port: 6377, host: "192.168.69.238"},
            {port: 6379, host: "192.168.69.237"},
            {port: 6378, host: "192.168.69.237"},
            {port: 6377, host: "192.168.69.237"}
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
var debounceRedis = [false];
debounceRedis.length = 16384;
var sioRedis = ioR.listen(serverRedis);
sioRedis.on('connection', function(socket) {
    console.log('Client connected to clusteredPUBSUBnode (redis) socket:' + socket.id);
});
serverRedis.listen(process.env.NODEPORT_HTTPREDIS, netIf);
cluster.on('message', function(channel, message) {
    var idx = message,
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
// Graceful shutdown
//
process.on('SIGINT', function() {
    sioRedis.close();
    serverRedis.close();
    console.log('clusteredPUBSUBnode websocket & HTTP/2 server connections closed');
    cluster.pipeline().unsubscribe('__keyevent@0__:hset').quit().exec();
    console.log('clusteredPUBSUBnode redis connection closed');
    setTimeout(function() { process.exit(0); }, 300);
});
