var http2         = require('http2'),
    fs            = require('fs'),
    tls           = require('tls'),
    Redis         = require('ioredis'),
    calculateSlot = require('cluster-key-slot'),
    ioR           = require('socket.io'),
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
// Graceful shutdown
//
process.on('SIGINT', function() {
    sioRedis.close();
    serverRedis.close();
    console.log('clusteredPUBSUBnode websocket & HTTP/2 server connections closed');
    cluster.pipeline().unsubscribe('__keyevent@0__:hset').quit().exec();
    console.log('clusteredPUBSUBnode redis connection closed');
    setTimeout(function() { process.exit(0); }, 450);
});
