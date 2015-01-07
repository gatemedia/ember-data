import Ember from 'ember';
import ModelChanges from 'gatemedia-data/utils/model-changes';
import attribute from 'gatemedia-data/utils/attribute';
import Constants from 'gatemedia-data/utils/constants';

/**
  Events (intended for local model post-processing):
    - record:saved
    - record:failed
 */
var Model = Ember.Object.extend(
  Ember.Evented,
{

  id: attribute('number', { serialize: false }),
  createdAt: attribute('datetime', { serialize: false }),
  updatedAt: attribute('datetime', { serialize: false }),

  _container: null,
  _attributeChanges: null,
  _relationChanges: null,
  /** Dereferenciated relations cache. Avoid processing time dereferencing (save, ...) */
  _relationsCache: null,

  /**
    Called before model saving.

    Intended for global model pre-processing.
   */
  willSave: Ember.K,
  /**
    Called after successful model saving.

    Intended for global model post-processing.
   */
  didSave: Ember.K,

  init: function () {
    this._super();
    this._resetChanges();
    this.resetCaches();
    this.set('meta', Ember.Object.create({
        isNew: true,
        isDirty: false,
        isDeleted: false
      })
    );
  },

  _url: function () {
    var parent = this.get('_parent'),
        parts = [];

    if (parent) {
      parts.pushObject(parent.get('_url'));
    }
    parts.pushObject(this.constructor.resourceUrl());
    if (!this.get('meta.isNew')) {
      parts.pushObject(this.get('id'));
    }
    return parts.join('/');
  }.property('meta.isNew', 'id'),

  _parent: function () {
    var ownerRelation = this.constructor.ownerRelation(Constants.STRICT_OWNER);

    if (ownerRelation) {
      var relationsCache = this.get('_relationsCache') || {};
      return relationsCache[ownerRelation.name] || this.get(ownerRelation.name);
    }
    return null;
  }.property().cacheable(false),

  _updateData: function (data) {
    var orig = this.get('_data') || {};
    this.set('_data', Ember.merge(orig, data));
    this._resetChanges();
    this._resetDirtyness();
    this.resetCaches();
  },

  /**
    Reload this instance's properties from passed raw data.
   */
  reloadFrom: function (data, key) {
    var type = this.constructor;
    key = key || type.resourceKey();

    this._updateData(data[key]);
    type.sideLoad(data, key);
    this.resetCaches();
  },

  /**
    Reload this instance from API.

    returns the promise of API call.
   */
  reload: function (options) {
    options = options || {};
    var store = this.get('_store'),
        key = this.constructor.toString().match(/model:(.+):/)[1];
    return store.find(key, this.get('id'), this.get('_parent'), Ember.merge(options, {
      noCache: true
    }));
  },

  _resetDirtyness: function () {
    this.get('meta').setProperties({
      isNew: false,
      isDirty: false
    });
    var parent = this.get('_parent');
    if (parent) {
      parent._computeDirtyness();
    }
  },

  _computeDirtyness: function () {
    var dirty = false;

    this.constructor.eachRelation(function (name, meta) {
      if (!meta.options.owner) {
        var cachedRelation = this.get('_relationsCache')[name];
        if (cachedRelation && cachedRelation.get('meta.isDirty')) {
          dirty = true;
        }
      }
    }, this);
    this.set('meta.isDirty', dirty);

    var parent = this.get('_parent');
    if (parent) {
      parent._computeDirtyness();
    }
  },

  _resetChanges: function () {
    this.set('_original', Ember.copy(this.get('_data'), true));
    this.set('_attributeChanges', ModelChanges.create());
    this.set('_relationChanges', ModelChanges.create());
  },

  resetCaches: function () {
    this.set('_relationsCache', {});
    this.expireCaches();
  },

  resetCache: function (relation) {
    this.set('_relationsCache.%@'.fmt(relation), null);
    this.expireCaches();
  },

  expireCaches: function () {
    this.set('_cacheTimestamp', new Date().getTime());
  },

  _changeAttribute: function (attribute, oldValue, newValue) {
    var embeddedContainer = this.get('_embeddedContainer'),
        path = (embeddedContainer ? this.get('_embeddedAttribute') + '.' : '') + attribute,
        changeHolder = embeddedContainer || this,
        attributeChanges = changeHolder.get('_attributeChanges');

    if (this.get('_original.' + path) === newValue) {
      attributeChanges.resetChanges(path);
      //TODO reset dirtyness
    } else {
      if (oldValue !== newValue) {
        attributeChanges.addChange(path, {
          attribute: path,
          oldValue: oldValue,
          newValue: newValue
        });
      }
      changeHolder.dirty();
    }
  },

  _addRelation: function (relation, addedMember) {
    this._changeRelation(relation, 'add', null, addedMember);
  },

  _removeRelation: function (relation, removedMember) {
    this._changeRelation(relation, 'remove', removedMember, null);
  },

  _replaceRelation: function (relation, oldRelated, newRelated) {
    this._changeRelation(relation, 'replace', oldRelated, newRelated);
  },

  _changeRelation: function (relation, action, oldMember, newMember) {
    var data = this.get('_data'),
        attr = '%@_id'.fmt(relation.singularize());

    if (data.hasOwnProperty(attr)) {
      data[attr] = newMember ? newMember.get('id') : null;
      this.resetCache(relation);
    } else {
      attr = attr.pluralize();
      if (!data.hasOwnProperty(attr)) {
        data[attr] = Ember.A();
      }
      if (oldMember) {
        data[attr].removeObject(oldMember.get('id'));
      }
      if (newMember) {
        data[attr].addObject(newMember.get('id'));
      }
    }

    this.get('_relationChanges').addChange(relation, {
      relation: relation,
      action: action,
      oldValue: oldMember,
      newValue: newMember
    });
    this.dirty();
  },

  _destroyRelation: function (relation, removedMember) {
    var data = this.get('_data'),
        attr = '%@_id'.fmt(relation.singularize());

    if (data.hasOwnProperty(attr)) {
      delete data[attr];
    } else {
      attr = attr.pluralize();
      data[attr].removeObject(removedMember.get('id'));
    }
    this.resetCache(relation);
  },

  dirty: function () {
    var parent = this.get('_parent'),
        embeddedContainer = this.get('_embeddedContainer');

    this.set('meta.isDirty', true);
    if (embeddedContainer) {
      embeddedContainer.dirty();
    }
    if (parent) {
      parent.dirty();
    }
  },

  hasChanges: function () {
    return this.get('_attributeChanges.hasChanges') ||
           this.get('_relationChanges.hasChanges') ||
           this.get('meta.isDirty');
  }.property('_attributeChanges.hasChanges', '_relationChanges.hasChanges', 'meta.isDirty'),

  deleteRecord: function () {
    var container = this.get('_container');

    if (container) {
      var removed = container.get('_removed');
      if (removed) {
        removed.pushObject(this);
      }
      container.removeObject(this);
    }

    this.set('meta.isDeleted', true);
    if (!this.get('meta.isNew')) {
      this.dirty();
    } else {
      this._resetDirtyness();
    }
  },

  unload: function () {
    var container = this.get('_container');
    if (container) {
      container.removeObject(this);
    }
  },

  saveProperties: function () {
    return this.save(null, Array.prototype.slice.call(arguments, 0));
  },

  save: function (extraParams, includeProperties) {
    this.set('meta.isSaving', true);
    this.willSave();
    var promise = new Ember.RSVP.Promise(function (resolve, reject) {

      function saveChildren (record, resolve/*, reject*/) {
        var relationCaches = record.get('_relationsCache'),
            savingTracker;

        savingTracker = Ember.Object.create({
          relationsToSave: [],

          save: function (relation) {
            this.get('relationsToSave').pushObject(relation);
          },
          saved: function (/*relation*/) {
            var relationsToSave = this.get('relationsToSave');
            relationsToSave.popObject();
            if (Ember.isEmpty(relationsToSave)) {
              resolve(record);
            }
          }
        });

        record.constructor.eachRelation(function (relation, meta) {
          if ((Ember.isNone(includeProperties) || includeProperties.contains(relation)) &&
              !meta.options.owner &&
              meta.options.cascadeSaving) {
            var relationCache = relationCaches[relation];
            if (relationCache) {
              savingTracker.save(relationCache);
              relationCache.save().then(function () {
                Ember.run(function () {
                  savingTracker.saved(relationCache);
                });
              });
            }
          }
        });
        savingTracker.saved(); // in case of no relation to save...
      }

      if (this.get('meta.isNew') || this.get('hasChanges') || this.get('meta.isDeleted')) {
        this.getAdapter().save(this, extraParams, includeProperties).then(function (record) {
          Ember.run(record, function () {
            saveChildren(this, resolve, reject);
          });
        }, function (error) {
          reject(error);
        });
      } else {
        saveChildren(this, resolve, reject);
      }
    }.bind(this));

    promise.then(function() {
      this.set('meta.isSaving', false);
      this.didSave();
      this.trigger('record:saved', this);
    }.bind(this), function() {
      this.set('meta.isSaving', false);
      this.trigger('record:failed', this);
    }.bind(this));
    return promise;
  },

  cancelChanges: function () {
    var relationCaches = this.get('_relationsCache');

    this.constructor.eachRelation(function (relation, meta) {
      if (meta.options.nested) {
        var relationCache = relationCaches[relation];
        if (relationCache) {
          relationCache.cancelChanges();
        }
      }
    });

    this._updateData(Ember.copy(this.get('_original'), true));
  },

  toJSON: function (includeProperties) {
    var json = {},
        processedKeys = [];

    this.constructor.eachAttribute(function (attribute, meta) {
      if ((meta.options.serialize !== false) && (Ember.isNone(includeProperties) || includeProperties.contains(attribute))) {
        json[meta.codec.key(attribute)] = meta.codec.encode(this, attribute);
      }
      processedKeys.pushObject(meta.codec.key(attribute));
    }, this);

    this.constructor.eachRelation(function (relation, meta) {
      if ((meta.options.serialize !== false) && (Ember.isNone(includeProperties) || includeProperties.contains(relation))) {
        json[meta.codec.key(relation)] = meta.codec.encode(this, relation);
      }
      processedKeys.pushObject(meta.codec.key(relation));
    }, this);

    Ember.assert("Model's internal state not initialized. Maybe you used .create() instead of .instanciate() for %@...".fmt(this),
      !Ember.isNone(this._data));
    Ember.keys(this._data).removeObjects(processedKeys).forEach(function (dynamicKey) {
      if (Ember.isNone(includeProperties) || includeProperties.contains(dynamicKey)) {
        json[dynamicKey] = this._data[dynamicKey];
      }
    }, this);

    return json;
  },

  getAdapter: function () {
    return this.constructor.getAdapter();
  },


  clearErrors: function () {
    var attributes = Array.prototype.slice.call(arguments, 0),
        errors = this.get('errors');
    if (errors) {
      attributes.forEach(function (attribute) {
        var err = errors.get(attribute);
        if (err) {
          err.clear();
        }
      });
    }
  }
});


Model.reopenClass({

  /**
   * Iterate through model relations, invoking callback with relation's name & meta.
   */
  eachAttribute: function (callback, binding) {
    this.eachComputedProperty(function (name, meta) {
      if (meta.isAttribute) {
        callback.call(binding || this, name, meta);
      }
    }, this);
  },

  /**
   * Iterate through model relations, invoking callback with relation's name & meta.
   */
  eachRelation: function (callback, binding) {
    this.eachComputedProperty(function (name, meta) {
      if (meta.isRelation) {
        callback.call(binding || this, name, meta);
      }
    }, this);
  },

  ownerRelation: function (checking) {
    var ownerRelation;

    this.eachRelation(function (relation, meta) {
      if (meta.options.owner && !((checking === Constants.STRICT_OWNER) && (meta.options.follow === false))) {
        ownerRelation = {
          name: relation,
          meta: meta
        };
      }
    }, this);
    return ownerRelation;
  }
});


export default Model;
