var Duplex = require('stream').Duplex,
    proxy  = require('../../node-http-proxy');
    http   = require('http'),
    https  = require('https'),
    url    = require('url'),
    util   = require('util');

var ProxyStream = module.exports = function ProxyStream(response, options) {
  Duplex.call(this);

  var self    = this,
      target  = options.target,
      source  = options.source;
 
  this.once('pipe', function(req) {
    var protocol = target.https ? https : http,
        outgoing = proxy._getBase(target);

    proxy._setupOutgoing(outgoing, target, req);

    if (options.changeOrigin) {
      outgoing.headers.host = target.host + ':' + target.port;
    }
    
    self.request = protocol.request(outgoing);
    self.on('finish', function() {
      self.request.end();
    });
    
    self.request.on('response', function (res) {
      self.response = res;
      if(req.httpVersion === '1.0') {
        res.headers.connection = req.headers.connection || 'close';
      }
      else if(!res.headers.connection) {
        res.headers.connection = req.headers.connection || 'keep-alive';
      }

      if(req.httpVersion === '1.0' || (req.method === 'DELETE' && !req.headers['content-length'])) {
        delete res.headers['transfer-encoding'];
      }

      if(~[301,302].indexOf(res.statusCode) && typeof res.headers.location !== 'undefined') {
        var location = url.parse(res.headers.location);
        if (
          location.host === req.headers.host &&
          ( 
            source.https && !target.https ||
            target.https && !source.https
          )
        ) {
          res.headers.location = res.headers.location.replace(/^https\:/, 'http:');
        }
      }

      try { 
        self.emit('proxyResponse', req, response, res); 
      } catch (e) {}

      Object.keys(res.headers).forEach(function (key) {
        response.setHeader(key, res.headers[key]);
      });
      response.writeHead(response.statusCode);
      
      res.on('readable', function() {
        self.read(0);
      });

      res.on('end', function() {
        self.push(null);
      });
      self.emit('readable');
    });

    // HACK: please fix it
    // Should we call end() splicity?
    self.end();

    
    //
    // Handle 'error' events from the `reverseProxy`. Setup timeout override if needed
    //
    self.request.once('error', proxyError);
/*
    // Set a timeout on the socket if `this.timeout` is specified.
    reverseProxy.once('socket', function (socket) {
      if (self.timeout) {
        socket.setTimeout(self.timeout);
      }
    }); */

  //
  // #### function proxyError (err)
  // #### @err {Error} Error contacting the proxy target
  // Short-circuits `res` in the event of any error when
  // contacting the proxy target at `host` / `port`.
  //
  function proxyError(err) {
    //
    // Emit an `error` event, allowing the application to use custom
    // error handling. The error handler should end the response.
    //
    // if (self.emit('proxyError', err, req, res)) {
    //   return;
    // }

    response.writeHead(500, { 'Content-Type': 'text/plain' });
    if (self.request.method !== 'HEAD') {
      //
      // This NODE_ENV=production behavior is mimics Express and
      // Connect.
      //
      response.write(process.env.NODE_ENV === 'production' 
        ? 'Internal Server Error'
        : 'An error has occurred: ' + JSON.stringify(err)
      );
    }

    try { response.end() }
    catch (ex) { console.error("res.end error: %s", ex.message) }
  }
  });

};

ProxyStream.prototype = Object.create(
  Duplex.prototype, { constructor:  { value: ProxyStream } }
);

ProxyStream.prototype._write = function(chunk, encoding, callback) {
  this.request.write(chunk, encoding, callback);
};

ProxyStream.prototype._read = function(size) {
  var chunk = this.response ? this.response.read(size) : '';
  if(chunk == null) { chunk = '' }
  this.push(chunk);
};