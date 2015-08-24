var http = require('http');
var https = require('https');
var url = require('url');
var zlib = require('zlib');

var api = require('planet-client');

var corsHeaders = {
  'Access-Control-Allow-Credentials': true,
  'Access-Control-Allow-Headers': 'Accept, Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'DELETE, GET, OPTIONS, POST, PUT',
  'Access-Control-Expose-Headers': 'Link',
  'Access-Control-Max-Age': 86400,
  'Allow': 'HEAD, GET, POST, OPTIONS',
  'Strict-Transport-Security': 'max-age=31536000',
  'Vary': 'Origin'
};

/**
 * Handler for all OPTIONS requests.
 * @param {http.IncomingMessage} req The request.
 * @param {http.ServerResponse} res The response.
 */
function optionsHandler(req, res) {
  var headers = assign({
    'Access-Control-Allow-Origin': req.headers.origin,
    'Content-Length': 0
  }, corsHeaders);

  res.writeHead(200, headers);
  res.end();
}

/**
 * Proxy handler for all non-scenes requests.
 * @param {http.IncomingMessage} req The request.
 * @param {http.ServerResponse} res The response.
 */
function proxyHandler(req, res) {
  var headers = req.headers;
  headers.host = 'api.planet.com';

  var options = {
    hostname: 'api.planet.com',
    method: req.method,
    path: url.parse(req.url).path,
    headers: headers
  };

  var proxyClient = https.request(options, function(serverRes) {
    res.writeHead(serverRes.statusCode, serverRes.headers);
    serverRes.pipe(res);
  });

  proxyClient.on('error', function(proxyErr) {
    process.stderr.write(proxyErr.message + '\n');
    res.writeHead(500, {'Content-Type': 'text/plain'});
    res.end('Proxy Error');
  });

  req.pipe(proxyClient);
}

/**
 * Transforms GeoJSON responses from the API to geobuf responses for the client.
 * @param {http.IncomingMessage} req The request.
 * @param {http.ServerResponse} res The response.
 * @param {api.Page} page A page of scenes.
 */
function scenesResponse(req, res, page) {
  var buffer = page.data;

  var linkHeader = [];
  if (page.nextLink) {
    linkHeader.push('<' + page.nextLink + '>; rel="next"');
  }
  if (page.prevLink) {
    linkHeader.push('<' + page.prevLink + '>; rel="prev"');
  }

  var headers = assign({
    'Content-Type': 'application/octet-stream',
    'Access-Control-Allow-Origin': req.headers.origin,
    'Link': linkHeader.join(', ')
  }, corsHeaders);

  var acceptEncoding = req.headers['accept-encoding'] || '';
  if (acceptEncoding.match(/\bgzip\b/)) {
    zlib.gzip(buffer, function(err, data) {
      if (err) {
        process.stderr.write(err.stack + '\n');
        res.writeHead(500);
        res.end('Unknown error');
      }
      assign(headers, {
        'Content-Length': data.length,
        'Content-Encoding': 'gzip'
      });
      res.writeHead(200, headers);
      res.end(data);
    });
  } else {
    headers['Content-Length'] = buffer.length;
    res.writeHead(200, headers);
    res.end(buffer);
  }

}

/**
 * Handles errors in fetching scenes from the API.
 * @param {http.IncomingMessage} req The request.
 * @param {http.ServerResponse} res The response.
 * @param {Error} err The API error.
 */
function scenesError(req, res, err) {
  var errResponse = err.response;
  if (errResponse) {
    res.writeHead(errResponse.statusCode, errResponse.headers);
    if (err.body) {
      res.write(JSON.stringify(err.body));
    }
    res.end();
  } else {
    process.stderr.write(err.stack + '\n');
    res.writeHead(500);
    res.end('Unknown error');
  }
}

/**
 * Handler for scenes requests.
 * @param {http.IncomingMessage} req The request.
 * @param {http.ServerResponse} res The response.
 */
function scenesHandler(req, res) {
  var authHeader = req.headers.authorization || '';
  var authParts = authHeader.split(' ');
  if (authParts[0] === 'api-key') {
    api.auth.setKey(authParts[1]);
  } else if (authParts[0] === 'Bearer') {
    api.auth.setToken(authParts[1]);
  } else if (authParts[0] === 'Basic') {
    var buffer = new Buffer(authParts[1], 'base64');
    var creds = String(buffer).split(':');
    api.auth.setKey(creds[0]);
  } else {
    res.writeHead(401, assign({
      'WWW-Authenticate': 'Basic realm="Please enter your API key"',
      'Content-Length': 0
    }, corsHeaders));
    res.end();
    return;
  }

  var parts = url.parse(req.url, true);
  var query = parts.query;
  query.type = parts.pathname.split('/')[3];

  api.scenes.search(query, {geobuf: true})
    .then(scenesResponse.bind(null, req, res))
    .catch(scenesError.bind(null, req, res))
}

/**
 * Top level request handler.
 * @param {http.IncomingMessage} req The request.
 * @param {http.ServerResponse} res The response.
 */
function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return optionsHandler(req, res);
  }

  var parts = url.parse(req.url, true);
  if (parts.query.format === 'geobuf' &&
      parts.pathname.indexOf('/v0/scenes/') === 0) {
    return scenesHandler(req, res);
  }

  return proxyHandler(req, res);
}

function assign(target, source) {
  for (var key in source) {
    target[key] = source[key];
  }
  return target;
}

if (require.main === module) {
  http.createServer(handler).listen(3003);
  process.stdout.write('Server started: http://localhost:3003/\n');
}
