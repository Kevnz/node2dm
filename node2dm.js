var dgram = require('dgram')
  , util = require('util')
  , https = require('https')
  , querystring = require('querystring')
  , emitter = require('events').EventEmitter

var config = {
    username: '',
    password: ''
}

function C2DMMessage(deviceToken, collapseKey, notification) {
    this.deviceToken = deviceToken;
    this.collapseKey = collapseKey;
    this.notification = notification;

    return this;
}

function C2DMReceiver(config, connection) {

    this.server = dgram.createSocket('udp4', function (msg, rinfo) {

        var msgParts = msg.toString().split(':', 3);
        if (msgParts.length != 3) {
            util.log("Invalid message");
            return;
        };
        var token = msgParts.shift();
        var collapseKey = msgParts.shift();
        var notification = msgParts.shift();

        util.log(token);
        util.log(collapseKey);
        util.log(notification);
        var c2dmMessage = new C2DMMessage(token, collapseKey, notification);
        connection.submitMessage(c2dmMessage);
    });
    this.server.bind(config.port || 8120, config.address || undefined);
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

    this.currentAuthorizationToken = "";

    var blockedFromSending = false;
    var authInProgress = false;

    this.loginCredentials = {
        username: config.username,
        password: config.password
    }

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
            // For now, if we receive a 503,
            // we'll drop any messages before
            // the Retry-After expires
            return;
        }
        var c2dmPostBody = {
            registration_id: message.deviceToken,
            collapse_key: message.collapseKey,
            "data.payload": message.notification,
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
                var retryAfter = response.headers['Retry-After'] || 10;
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
        util.log('auth-ing with google');
        authInProgress = true;

        var loginBody = {
            "accountType": "HOSTED_OR_GOOGLE",
            "Email": this.loginCredentials.username,
            "Passwd": this.loginCredentials.password,
            "service": "ac2dm",
            "source": "com.burbn.instagram"
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
                }
                util.log('auth token: ' + self.currentAuthorizationToken);
                self.emit('loginComplete');
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