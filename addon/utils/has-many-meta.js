
export default function hasManyMeta(type, options) {
  options = options || {};
  return {
    type: type,
    isRelation: true,
    options: options,
    codec: {
      key: function (key) {
        if (options.alias) {
          key = options.alias;
        }
        if (options.inline) {
          return key.decamelize().pluralize();
        }
        return '%@_ids'.fmt(key.decamelize().singularize());
      },

      encode: function (instance, attribute) {
        var cache = instance.get('_relationsCache.%@'.fmt(attribute));

        if (options.inline) {
          cache = cache || instance.get('_data.' + this.key(attribute));
          return cache.map(function (item) {
            return item.toJSON();
          });
        } else {
          if (cache) {
            return cache.getEach('id');
          }
          return instance.get('_data.' + this.key(attribute));
        }
      }
    }
  };
}
