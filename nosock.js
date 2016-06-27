var http2         = require('http2'),
    fs            = require('fs'),
    tls           = require('tls'),
    Redis         = require('ioredis'),
    calculateSlot = require('cluster-key-slot'),
    ioR           = require('socket.io'),
    ioN           = require('socket.io'),
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
                                       }),
    serverNode    = http2.createServer({
                                           key:  fs.readFileSync('./nginx-selfsigned.key'),
                                           cert: fs.readFileSync('./nginx-selfsigned.crt')
                                       });
//
// Listen to redis changes and notify
//
var sioRedis = ioR.listen(serverRedis);
sioRedis.on('connection', function(socket) {
    console.log('Client connected to clusteredPUBSUBnode (redis) socket:' + socket.id);
});
serverRedis.listen(process.env.NODEPORT_HTTPREDIS, process.env.NODEIP);
cluster.on('message', function (channel, message) {
    sioRedis.volatile.emit('set', {
        x: (message / 1024) | 0,
        y: message % 32,
        h: (calculateSlot('cn:' + message) / 5462) | 0
    });
});
cluster.subscribe('__keyevent@0__:hset',function(){
    console.log('clusteredPUBSUBnode subscribed to redis live events stream');
});
//
// Listen to node executions and notify
//
var mapRasp = {raspberrypi2: 0, raspberrypi3: 1, raspberrypi5: 2, raspberrypi6: 3};
var sioNode = ioN.listen(serverNode);
sioNode.on('connection', function(socket) {
    console.log('Client connected to clusteredPUBSUBnode (node) socket:' + socket.id);
    socket.on('exec', function(data) {
        sioRedis.volatile.emit('node', mapRasp[data.pi] + ',' + data.pid);
    });
});
serverNode.listen(process.env.NODEPORT_HTTPNODE, process.env.NODEIP);
//
// Graceful shutdown
//
process.on('SIGINT', function() {
    sioRedis.close();
    serverRedis.close();
    sioNode.close();
    serverNode.close();
    console.log('clusteredPUBSUBnode HTTPS servers (redis/node) closed');
    cluster.pipeline().unsubscribe('__keyevent@0__:hset').quit().exec();
    console.log('clusteredPUBSUBnode redis connection closed');
    setTimeout(function() { process.exit(0); }, 500);
});
