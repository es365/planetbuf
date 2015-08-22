var http = require('http');
var https = require('https');
var url = require('url');

var api = require('planet-client');

var corsHeaders = {
  'Access-Control-Allow-Credentials': true,
  'Access-Control-Allow-Headers': 'Accept, Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'DELETE, GET, OPTIONS, POST, PUT',
  'Access-Control-Expose-Headers': 'Links',
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

  var linksHeader = [];
  if (page.nextLink) {
    linksHeader.push('<' + page.nextLink + '>; rel="next"');
  }
  if (page.prevLink) {
    linksHeader.push('<' + page.prevLink + '>; rel="prev"');
  }

  var headers = assign({
    'Content-Type': 'application/octet-stream',
    'Content-Length': buffer.length,
    'Access-Control-Allow-Origin': req.headers.origin,
    'Links': linksHeader.join(', ')
  }, corsHeaders);

  res.writeHead(200, headers);
  res.end(buffer);
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
    process.stderr.write(err.message + '\n');
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
  api.auth.setKey(req.headers.authorization.split(' ')[1])

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
