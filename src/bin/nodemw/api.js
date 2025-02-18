/**
 * Helper "class" for accessing MediaWiki API and handling cookie-based session
 */
"use strict";

// introspect package.json to get module version
const VERSION = require("../../../package.json").version;

// @see https://github.com/caolan/async
const async = require("async");

// @see https://github.com/mikeal/request
const request = require("request");

function doRequest(params, callback, method, done) {
  // store requested action - will be used when parsing a response
  const actionName = params.action;
  // "request" options
  const options = {
    method: method || "GET",
    proxy: this.proxy || false,
    jar: this.jar,
    headers: {
      "User-Agent": this.userAgent,
    },
  };

  // HTTP request parameters
  params = params || {};

  // force JSON format
  params.format = "json";

  // handle uploads
  if (method === "UPLOAD") {
    options.method = "POST";

    const CRLF = "\r\n",
      postBody = [],
      boundary = `nodemw${Math.random().toString().slice(2)}`;

    // encode each field
    Object.keys(params).forEach(function (fieldName) {
      const value = params[fieldName];

      postBody.push(`--${boundary}`);
      postBody.push(CRLF);

      if (typeof value === "string") {
        // properly encode UTF8 in binary-safe POST data
        postBody.push(`Content-Disposition: form-data; name="${fieldName}"`);
        postBody.push(CRLF);
        postBody.push(CRLF);
        postBody.push(Buffer.from(value, "utf8"));
      } else {
        // send attachment
        postBody.push(
          `Content-Disposition: form-data; name="${fieldName}"; filename="foo"`,
        );
        postBody.push(CRLF);
        postBody.push(CRLF);
        postBody.push(value);
      }

      postBody.push(CRLF);
    });

    postBody.push(`--${boundary}--`);

    // encode post data
    options.headers["content-type"] =
      `multipart/form-data; boundary=${boundary}`;
    options.body = postBody.join('');
  }

  // form an URL to API
  options.url = this.formatUrl({
    protocol: this.protocol,
    port: this.port,
    hostname: this.server,
    pathname: this.path + "/api.php",
    query: options.method === "GET" ? params : {},
  });

  // POST all parameters (avoid "request string too long" errors)
  if (method === "POST") {
    options.form = params;
  }

  request(options, (error, response, body) => {
    response = response || {};

    if (error) {
      this.error(`Request to API failed: ${error}`);
      callback(new Error(`Request to API failed: ${error}`));
      done();
      return;
    }

    if (response.statusCode !== 200) {
      this.error(
        `Request to API failed: HTTP status code was ${response.statusCode} for <${options.url}>`,
      );
      callback(
        new Error(
          `Request to API failed: HTTP status code was ${response.statusCode}`,
        ),
      );
      done();
      return;
    }

    // parse response
    let data, info, next;

    try {
      data = JSON.parse(body);
      info = data && data[actionName];

      // acfrom=Zeppelin Games
      next =
        data &&
        data["query-continue"] &&
        data["query-continue"][params.list || params.prop];

      // handle the new continuing queries introduced in MW 1.21
      // (and to be made default in MW 1.26)
      // issue #64
      // @see https://www.mediawiki.org/wiki/API:Query#Continuing_queries
      if (!next) {
        // cmcontinue=page|5820414e44205920424f534f4e53|12253446, continue=-||
        next = data && data.continue;
      }
    } catch (e) {
      this.error("Error parsing JSON response");
      callback(new Error("Error parsing JSON response"));
      done();
      return;
    }

    if (data && !data.error) {
      if (next) {
        this.info("Continuing query with", next);
      }

      callback(null, info, next, data);
    } else if (data.error) {
      this.error(`Error returned by API: ${data.error.info}`);
      callback(new Error(`Error returned by API: ${data.error.info}`));
    }
    done();
  });
}

function Api(options) {
  this.protocol = options.protocol || "https";
  this.port = options.port;
  this.server = options.server;
  this.path = options.path;
  this.proxy = options.proxy;
  this.jar = request.jar(); // create new cookie jar for each instance

  this.debug = options.debug;

  // requests queue
  // @see https://github.com/caolan/async#queue
  this.queue = async.queue(function (task, callback) {
    // process the task (and call the provided callback once it's completed)
    task(callback);
  }, options.concurrency || 1);

  // HTTP client
  this.formatUrl = require("url").format;

  this.userAgent =
    options.userAgent ||
    `nodemw/${VERSION} (node.js ${process.version}; ${process.platform} ${process.arch})`;
  this.version = VERSION;

  // debug info
  this.info(process.argv.join(" "));
  this.info(this.userAgent);

  let port = this.port ? `:${this.port}` : "";

  this.info(
    `Using <${this.protocol}://${this.server}${port}${this.path}/api.php> as API entry point`,
  );
  this.info("----");
}

// public interface
Api.prototype = {
  log() {
    if (this.debug) {
      console.log.apply(console, arguments);
    }
  },

  info() {
    if (this.debug) {
      console.info.apply(console, arguments);
    }
  },

  warn() {
    if (this.debug) {
      console.warn.apply(console, arguments);
    }
  },

  error() {
    if (this.debug) {
      console.error.apply(console, arguments);
    }
  },

  // adds request to the queue
  call(params, callback, method) {
    this.queue.push((done) => {
      doRequest.apply(this, [params, callback, method, done]);
    });
  },

  // fetch an external resource
  fetchUrl(url, callback, encoding) {
    encoding = encoding || "utf-8";

    // add a request to the queue
    this.queue.push((done) => {
      this.info("Fetching <%s> (as %s)...", url, encoding);

      const options = {
        url,
        method: "GET",
        proxy: this.proxy || false,
        jar: this.jar,
        encoding: encoding === "binary" ? null : encoding,
        headers: {
          "User-Agent": this.userAgent,
        },
      };

      request(options, (error, response, body) => {
        if (!error && response.statusCode === 200) {
          this.info(
            "<%s>: fetched %s kB",
            url,
            (body.length / 1024).toFixed(2),
          );
          callback(null, body);
        } else {
          if (!error) {
            error = new Error(`HTTP status ${response.statusCode}`);
          }

          this.error(`Failed to fetch <${url}>`);
          this.error(error.message);
          callback(error, body);
        }

        done();
      });
    });
  },
};

module.exports = Api;
