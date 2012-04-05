node2dm
======

A node.js server for sending push notifications to Google's C2DM push notification server.  Written by [Instagram](http://instagram.com/) to support our Android application, and inspired by [statsd](http://github.com/etsy/statsd)'s protocol.

Setting up
-------

Copy the provided exampleConfig.js into a config.js file, and follow the instructions in the file to fill out your application's Google account credentials. Then just run:

    node node2dm.js /path/to/config/file

A sample upstart script is included for easy deployment on Ubuntu.


Pushing a message
-------

Messages are pushed to the service using simple UDP datagrams, separated by a colon; here's what our Python application server code looks roughly like:

    c2dm_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    encoded_payload = '%s:%s:%s' % (
        device_token,
        collapse_key,
        simplejson.encode(c2dm_payload)
    )
    c2dm_socket.sendto(encoded_payload,
                             (c2dm_server, c2dm_port))

As you can see from the example, the datagram looks as follows:

    device_token:collapse_key:json_encoded_payload

We chose UDP because we wanted to minimize latency between our application servers and the node2dm service, and don't have hard delivery requirements for push notifications.

Rate limits / errors
------

node2dm handles a variety of errors that may be passed back from the C2DM service:

  - *401*: Will force a re-authentication with the C2DM service
  * *503*: Will back off, respecting the Retry-After header
  * *QuotaExceeded*: In this case, your application has exceeded Google's quota for pushes for the day. node2dm will write out a quota.lock file and quit itself
  * *DeviceQuotaExceeded*: You're sending too many pushes to this device; node2dm will blacklist this token for an hour before trying to send any more messages
  * *InvalidRegistration*/*NotRegistered*: Something's wrong with this device token; node2dm will drop the message
  * *MessageTooBig*: node2dm will drop this message

Bad token callbacks
---------

node2dm supports a simple webhook-like callback on a bad token error from Google. To set it up, configure serverCallbackHost / serverCallbackPort / serverCallbackPath / serverCallbackSharedSecret in your config.js, and you should start receive POST requests with this payload:

    device_token (the offending device token)
	message_body (the body of the message that was being attempted; can be useful if you need to match something back up on your end)
	shared_secret (the serverCallbackSharedSecret, can match up on your end to make sure it's the right server sending you a ping)
	



Getting stats
------

node2dm comes with a simple, telnet-able stats function. To use it:

    > echo "stats" | nc localhost 8121
    uptime: 226 seconds
    messages_sent: 20583
    messages_in_queue: 0
    backing_off: false
    total_errors: 9
    rate_limited_tokens: 0
    logged_in_to_c2dm: true
    token_age: 221
    memory_rss: 88793088
    memory_heapTotal: 11075584
    memory_heapUsed: 3658300

Contributing
------

The project is BSD-licensed; please fork and submit a pull request for any improvements you'd like to see in node2dm.