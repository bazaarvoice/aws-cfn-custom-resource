'use strict';

var _ = require('lodash');
var q = require('q');
var cfnUtil = require('./util');
var util = require('util');

function CloudFormationEvent (event, context, log) {
  _.assign(this, event);
  this.context = context;
  this.log = log.child({type: 'CloudFormationEvent'});

  // arn:aws:cloudformation:us-east-1:123456789012:stack/mystack-mynestedstack-sggfrhxhum7w/f449b250-b969-11e0-a185-5081d0136786
  var stackId = this.StackId.split(':');
  var stackName = stackId[5].split('/');

  this.stack = {
    arn: this.StackId,
    region: stackId[3],
    accountId: stackId[4],
    name: stackName[1]
  };
}

CloudFormationEvent.prototype.send = function (body) {
  var responseBody = JSON.stringify(body);

  var https = require('https');
  var url = require('url');

  var parsedUrl = url.parse(this.ResponseURL);
  var options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || 443,
    path: parsedUrl.path,
    method: 'PUT',
    headers: {
      'content-type': '',
      'content-length': responseBody.length
    }
  };
  var context = this.context;
  var log = this.log;
  var attemptCount = 0;

  (function sendRequest () {
    attemptCount += 1;

    var request = https.request(options, function (response) {
      log.info({ code: response.statusCode, status: response.statusMessage, body: body }, 'Custom Resource Response Sent');
      context.done();
    });

    request.on('error', function (error) {
      if (attemptCount >= 4) {
        log.error(error, 'Send CFN result failed (giving up)');
        context.done();
      } else {
        log.warn(error, 'Send CFN result failed (will retry)');
        q.delay(250).then(sendRequest);
      }
    });

    request.write(responseBody);
    request.end();
  })();
};

CloudFormationEvent.prototype.failed = function (reason) {
  var r = {
    Status: 'FAILED',
    Reason: util.format('%s (%s)', reason, this.context.logStreamName),
    StackId: this.StackId,
    RequestId: this.RequestId,
    LogicalResourceId: this.LogicalResourceId,
    PhysicalResourceId: this.getPhysicalResourceId()
  };
  this.log.warn(r, "signalling failed");
  this.send(r);
};

CloudFormationEvent.prototype.success = function (physicalResourceId, data) {
  var r = {
    Status: 'SUCCESS',
    StackId: this.StackId,
    RequestId: this.RequestId,
    LogicalResourceId: this.LogicalResourceId,
    PhysicalResourceId: physicalResourceId || this.getPhysicalResourceId(),
    Data: data || undefined
  };
  this.log.info(r, 'signalling success');
  this.send(r);
};

CloudFormationEvent.prototype.getPhysicalResourceId = function () {
  if (!this.PhysicalResourceId) {
    this.PhysicalResourceId = cfnUtil.generateResourceId(this.stack.name, this.LogicalResourceId);
  }

  return this.PhysicalResourceId;
};

exports.CloudFormationEvent = CloudFormationEvent;
