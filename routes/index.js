'use strict';
/** 注册所有路由 */

module.exports = function registerRoutes(app) {
  require('./state')(app);
  require('./auth')(app);
  require('./courses')(app);
  require('./sign')(app);
  require('./face')(app);
  require('./places')(app);
  require('./plans')(app);
};
