'use strict';

var _ = require('lodash');
var bunyan = require('bunyan');

exports.cfn = require('./cfn');
exports.aws = require('./aws');

_.assign(exports, require('./util'));

exports.handler = function (resources) {
  var util = require('util');
  var Q = require('q');

  return function (event, context) {
    var log = bunyan.createLogger({ name: event.ResourceType, type: 'root' });

    log.info({ Event: event, Context: context }, 'Custom Resource Request Received');
    var cfnEvent = new exports.cfn.CloudFormationEvent(event, context, log);

    var failed = function (err) {
      var reason = err;

      if (_.isError(err)) {
        log.error(err, 'Custom Resource Failed');
        reason = err.toString();
      } else {
        log.error({ err: err }, 'Custom Resource Failed');

        if (!_.isString(err)) {
          reason = JSON.stringify(err);
        }
      }

      cfnEvent.failed(reason);
    };

    try {
      var resourceLoader = resources[cfnEvent.ResourceType];

      if (!resourceLoader) {
        if (cfnEvent.RequestType === 'Delete') {
          // If there is no resource loader on delete, it is most likely that
          // the create failed for the same reason. A failure response here
          // puts the stack in a state where it can never be deleted as the
          // delete operation will continuously fail.
          cfnEvent.success();
        } else {
          cfnEvent.failed(util.format('Unknown or invalid resource type: %s', cfnEvent.ResourceType));
        }

        return;
      }

      var resourceModule = resourceLoader();
      var handlerFuncName = util.format('handle%s', cfnEvent.RequestType);
      var handlerFunc = resourceModule[handlerFuncName];

      if (!handlerFunc) {
        cfnEvent.failed(util.format('Missing resource handler: resource=%s; function=%s', cfnEvent.ResourceType, handlerFuncName));
        return;
      }

      Q(handlerFunc(cfnEvent))
      .then(function (result) {
        if (_.isObject(result)) {
          cfnEvent.success(result.physicalResourceId, result.data);
        } else {
          cfnEvent.success();
        }
      })
      .catch(failed);
    } catch (e) {
      failed(e);
    }
  };
};
