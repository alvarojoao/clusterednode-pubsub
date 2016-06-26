var https         = require('https'),
    fs            = require('fs'),
    tls           = require('tls'),
    Redis         = require('ioredis'),
    calculateSlot = require('cluster-key-slot'),
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
    server = https.createServer({
                                    key:  fs.readFileSync('./nginx-selfsigned.key'),
                                    cert: fs.readFileSync('./nginx-selfsigned.crt')
                                });
process.on('SIGINT', function() {
    server.close();
    console.log('clusteredPUBSUBnode HTTPS server closed');
    cluster.pipeline().unsubscribe('__keyevent@0__:hset').quit().exec();
    console.log('clusteredPUBSUBnode redis connection closed');
    setTimeout(function() { process.exit(0); }, 500);
});
var io = require('socket.io').listen(server);
io.on('connection',function(socket){
    console.log('Client connected to clusteredPUBSUBnode socket:'+socket.id);
});
server.listen(process.env.NODEPORT,process.env.NODEIP);
cluster.on('message', function (channel, message) {
    io.volatile.emit('set', {x: (message / 1024) | 0, y: message % 32, h: (calculateSlot('cn:' + message) / 5462) | 0});
});
cluster.subscribe('__keyevent@0__:hset',function(){
    console.log('clusteredPUBSUBnode subscribed to redis live events stream');
});
