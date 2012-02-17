var dgram = require('dgram')
  , util = require('util')
  , https = require('https')
  , querystring = require('querystring')
  , emitter = require('events').EventEmitter
  , config = require('./config')


function C2DMMessage(deviceToken, collapseKey, notification) {
    this.deviceToken = deviceToken;
    this.collapseKey = collapseKey;
    this.notification = notification;

    return this;
}

function C2DMReceiver(config, connection) {

    this.server = dgram.createSocket('udp4', function (msg, rinfo) {

        var msgParts = msg.toString().match(/^([^:]+):([^:]+):(.*)$/);
        util.log(msgParts);
        if (!msgParts) {
            util.log("Invalid message");
            return;
        };
        var token = msgParts[1];
        var collapseKey = msgParts[2];
        var notification = msgParts[3];

        util.log(token);
        util.log(collapseKey);
        util.log(notification);
        var c2dmMessage = new C2DMMessage(token, collapseKey, notification);
        connection.submitMessage(c2dmMessage);
    });
    this.server.bind(config.port || 8120);
    util.log("server is up");
    return this;
}


function C2DMConnection(config) {

    var self = this;

    this.c2dmServerOptions = {
        "host": "android.apis.google.com",
        "path": "/c2dm/send",
        "method": "POST"
    }

    this.loginOptions = {
        "host": "www.google.com",
        "path": "/accounts/ClientLogin",
        "method": "POST",
        "headers": {'Content-Type': 'application/x-www-form-urlencoded'}

    }

    this.currentAuthorizationToken = null;
    this.authFails = 0;

    var blockedFromSending = false;
    var retryAfter = 0;
    var authInProgress = false;

    this.onError = function(err) {
        var errMessage = err.match(/Error=(.+)$/);
        if (!errMessage) {
            util.log("Unknown error: " + err);
        }
        var googleError = errMessage[1];
        util.log(googleError);
        switch (googleError) {
            case "QuotaExceeded":
                // back off..
                break;

            case "DeviceQuotaExceeded":
                // blacklist device
                break;

            case "InvalidRegistration":
                // callback to our service
                break;

            case "NotRegistered":
                // callback to our service
                break;

            case "MessageTooBig":
                break;

        }

    }

    this.sendRequest = function(message) {
        if (blockedFromSending) {
            setTimeout(function(){
                this.submitRequest(message);
            }, retryAfter * 1000);
            return;
        }
        var c2dmPostBody = {
            registration_id: message.deviceToken,
            collapse_key: message.collapseKey,
            "data.data": message.notification,
        }

        var stringBody = querystring.stringify(c2dmPostBody);
        var requestOptions =  {
            'host': this.c2dmServerOptions.host,
            'path': this.c2dmServerOptions.path,
            'method': 'POST',
            'headers': {
                'Content-Length': stringBody.length,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        };
        requestOptions['headers']['Authorization'] = 'GoogleLogin auth=' + this.currentAuthorizationToken;
        var postRequest = https.request(requestOptions, function(response) {
            if (response.statusCode == 401) {
                // we need to reauthenticate
                self.currentAuthorizationToken = null;
                // requeue message
                self.submitMessage(message);
            } else if (response.statusCode == 503) {
                retryAfter = parseInt(response.headers['Retry-After'], 10) || 10;
                blockedFromSending = true;
                setTimeout(function() {
                    blockedFromSending = false;
                }, retryAfter * 1000);
            } else if (response.statusCode == 200) {
                response.setEncoding('utf-8');
                response.on('data', function(chunk) {
                    util.log('response: ' + chunk);
                    var returnedID = chunk.match(/id=/);
                    if (!returnedID) {
                        self.onError(chunk);
                    } else {
                        util.log("message sent successfully!");
                    }
                });
            }
        });

        postRequest.on('error', function(error) {
            util.log(error);
        });

        postRequest.write(stringBody);
        postRequest.end();
    }

    this.submitMessage = function(message) {
        if (this.currentAuthorizationToken && this.currentAuthorizationToken.length) {
            this.sendRequest(message);
        } else {
            this.authenticate();
            this.once('loginComplete', function() {
                this.sendRequest(message);
            });
        }
    }

    this.authenticate = function() {
        if (authInProgress) {
            return;
        }
        if (this.authFails) {
            // make this exponential
            util.log("Sleeping because of fails: " + this.authFails);
            setTimeout(function() {
                self.authenticate();
            }, this.authFails * 10 * 1000);
            return;
        }


        util.log('auth-ing with google');
        authInProgress = true;

        var loginBody = {
            "accountType": "HOSTED_OR_GOOGLE",
            "Email": config.username,
            "Passwd": config.password,
            "service": "ac2dm",
            "source": config.source
        }
        var loginBodyString = querystring.stringify(loginBody);
        this.loginOptions['headers']['Content-Length'] = loginBodyString.length;
        var loginReq = https.request(this.loginOptions, function(res) {
            res.setEncoding('utf-8');
            var buffer = '';
            res.on('data', function(data) {
                buffer += data;
            });
            res.on('end', function() {
                var token = buffer.match(/Auth=(.+)[$|\n]/);
                if (token) {
                    self.currentAuthorizationToken = token[1];
                    self.authFails = 0;
                    self.emit('loginComplete');
                } else {
                    self.authFails++;
                }
                util.log('auth token: ' + self.currentAuthorizationToken);
                authInProgress = false;
            });
        });
        loginReq.on('error', function(e) {
            util.log(e);
            authInProgress = false;
        });
        loginReq.write(loginBodyString);
        loginReq.end();
    };
    return this;
}

util.inherits(C2DMConnection, emitter);


var connection = new C2DMConnection(config);
var receiver = new C2DMReceiver(config, connection);