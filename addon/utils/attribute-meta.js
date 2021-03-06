import Ember from 'ember';
import codec from 'gatemedia-data/utils/codec';

export default function (type, options) {
  options = options || {};
  return {
    type: type,
    isAttribute: true,
    options: options,
    codec: {
      key: function (key) {
        if (options.key) {
          key = options.key;
        }
        return Ember.String.underscore(Ember.String.decamelize(key));
      },

      decode: function (value) {
        var parts = type.split(':'),
            basicType = parts[0],
            qualifier = parts[1];

        return codec[basicType].decode(value, qualifier);
      },

      encode: function (instance, attribute) {
        var parts = type.split(':'),
            basicType = parts[0],
            qualifier = parts[1],
            value = attribute ? instance.get(attribute) : instance;

        if (options.formatter) {
          return options.formatter(value, qualifier);
        }
        return codec[basicType].encode(value, qualifier);
      }
    }
  };
}
