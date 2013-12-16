
Data.Adapter = Ember.Object.extend({

  baseUrl: Ember.required(),
  /**
    To be defined as needed by app.
   */
  authParams: null,

  GET: function (url, data) {
    var settings = {
      type: 'GET',
      url: '%@/%@'.fmt(this.get('baseUrl'), url),
      data: this.buildParams(data)
    };
    return this._promisifiedAjax(settings);
  },

  POST: function (url, data) {
    return this._jsonBasedAjax('POST', url, data);
  },
  PUT: function (url, data) {
    return this._jsonBasedAjax('PUT', url, data);
  },
  DELETE: function (url, data) {
    return this._jsonBasedAjax('DELETE', url, data);
  },

  _jsonBasedAjax: function (action, url, data) {
    var settings = {
      type: action,
      url: '%@/%@'.fmt(this.get('baseUrl'), url),
      contentType: 'application/json',
      dataType: 'json',
      data: JSON.stringify(this.buildParams(data))
    };
    return this._promisifiedAjax(settings);
  },

  _promisifiedAjax: function (settings) {
    return new Ember.RSVP.Promise(function (resolve, reject) {
      Data.ajax(settings).
      done(function (data) {
        resolve(data);
      }).
      fail(function (xhr, status, error) {
        Ember.run(function () {
          Ember.Logger.error(status + ':', settings.method, settings.url, error);
          reject(error);
        });
      });
    });
  },

  findOne: function (type, id, parent, options) {
    options = options || {};
    return this.findWithCache(options,
      function (ok) {
        var cached = type.cachedRecord(id);
        if (cached) {
          ok(cached);
          return true;
        }
        return false;
      },
      function (async, ok, ko) {
        var action = 'GET',
            url = this.buildUrl(type, id, parent);

        Data.ajax({
          async: async,
          type: action,
          url: url,
          dataType: 'json',
          data: this.buildParams(options.params)
        }).
        done(function (data) {
          Ember.Logger.debug("DATA - Found one", type, "(" + id + "):", data);
          var resourceKey = type.resourceKey();

          if (data[resourceKey]) {
            var record = type.load(data[resourceKey]);
            type.sideLoad(data);
            ok(record);
          } else {
            var message = "API returned JSON with missing key '" + resourceKey + "'";
            Ember.Logger.error(message, data);
            ko(message);
          }
        }).
        fail(function (xhr, status, error) {
          Ember.Logger.error(status + ':', action, url, error);
          ko(error);
        });
      }
    );
  },

  findMany: function (type, ids, parent, options) {
    options = options || {};
    return this.findWithCache(options,
      function (ok) {
        var cached = ids.map(function (id) {
          return type.cachedRecord(id);
        }).compact();

        if (!Ember.isEmpty(ids) && (cached.length === ids.length)) {
          ok(cached);
          return true;
        }
        return false;
      },
      function (async, ok, ko) {
        var action = 'GET',
            url = this.buildUrl(type, null, parent);

        Data.ajax({
          async: async,
          type: action,
          url: url,
          dataType: 'json',
          data: this.buildParams(options.params, {
            ids: ids, // Ember.isEmpty(ids) ? null : ids,
          })
        }).
        done(function (data) {
          Ember.Logger.debug("DATA - Found many", type, (parent ? "(parent " + parent.toString() + ")" : '') + ":", data);
          var resourceKey = type.resourceKey().pluralize(),
              result = [];

          if (data[resourceKey]) {
            result.addObjects(data[resourceKey].map(function (itemData) {
              return type.load(itemData);
            }));
            type.sideLoad(data);
            ok(result);
          } else {
            Ember.Logger.error("API returned JSON with missing key '" + resourceKey + "'", data);
            ko();
          }
        }).
        fail(function (xhr, status, error) {
          Ember.Logger.error(status + ':', action, url, error);
          ko(error);
        });
      });
  },

  findWithCache: function (options, findInCache, find) {
    options = options || {};

    var adapter = this,
        async = !options.sync,
        noCache = options.noCache;

    function run (async, noCache, resolve, reject) {
      var result = null;

      function ok (record) {
        Ember.run(function () {
          if (async) {
            resolve(record);
          } else {
            result = record;
          }
        });
      }

      function ko (error) {
        Ember.run(function () {
          if (async) {
            reject(error);
          } else {
            result = null;
          }
        });
      }

      if (noCache || !findInCache.call(adapter, ok)) {
        find.call(adapter, async, ok, ko);
      }
      return result;
    }

    if (async) {
      return new Ember.RSVP.Promise(function (resolve, reject) {
        run(true, noCache, resolve, reject);
      });
    } else {
      return run(false, noCache);
    }
  },

  save: function (record, extraParams, includeProperties) {
    var adapter = this,
        url = [ adapter.get('baseUrl'), record.get('_url') ].join('/'),
        action,
        async = true,
        params = {},
        resourceKey = record.constructor.resourceKey();

    return new Ember.RSVP.Promise(function (resolve, reject) {
      Ember.run(adapter, function () {
        if (!(record.get('meta.isDirty') || record.get('meta.isNew'))) {
          Ember.Logger.warn('Do not save clean record: ' + record.toString());
          record.unload();
          resolve();
          return;
        }

        if (record.get('meta.isDeleted')) {
          action = 'DELETE';
        } else {
          params[resourceKey] = record.toJSON(includeProperties);

          if (record.get('meta.isNew')) {
            action = 'POST';
          } else {
            action = 'PUT';
          }
        }

        Data.ajax({
          async: async,
          type: action,
          url: url,
          // dataType: 'json', // avoid dataType, as it breaks when body is empty.
          contentType: 'application/json',
          data: JSON.stringify(adapter.buildParams(params, extraParams))
        }).
        done(function (data) {
          Ember.run(function () {
            Ember.Logger.debug("DATA - Saved (" + action + ")",
              record.toString(), (parent ? "(parent " + parent.toString() + ")" : '') + ":", data);

            if (data && data[resourceKey]) {
              record._updateData(data[resourceKey]);
              record.constructor.sideLoad(data);
              resolve(record);
            } else {
              if (action === 'DELETE') {
                record.unload();
                resolve(record);
              } else {
                Ember.Logger.warn("API returned JSON with missing key '%@'".fmt(resourceKey), data);
                resolve(record);
              }
            }
          });
        }).
        fail(function (xhr, status, error) {
          Ember.run(function () {
            Ember.Logger.error(status + ':', action, url, error);
            reject(xhr);
          });
        });
      });
    });
  },

  buildUrl: function (type, id, parent) {
    var urlParts = [
      this.get('baseUrl')
    ];

    if (parent) {
      urlParts.pushObject(parent.get('_url'));
    }
    urlParts.pushObject(type.resourceUrl());
    if (id) {
      urlParts.pushObject(id);
    }
    return urlParts.join('/');
  },

  buildParams: function (optionParams, extraParams) {
    var params = {};
    $.extend(params, this.get('authParams'));

    if (optionParams) {
      $.extend(params, optionParams);
    }
    if (extraParams) {
      $.extend(params, extraParams);
    }
    return params;
  },
});
