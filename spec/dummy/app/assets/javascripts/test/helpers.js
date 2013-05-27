//= require lib/sinon-1.6.0
//= require lib/sinon-server-1.6.0

function fakeAPI (api, method, url, message) {
    var url, data;

    switch (method) {
    case 'GET':
        if (Ember.typeOf(url) === 'regexp') {
            url = new RegExp('%@/%@'.fmt(Global.apiUrl, url.source))
        } else {
            if (url.indexOf('?') >= 0) {
                var
                    parts = url.split('?'),
                    action = parts[0],
                    params = parts[1];
                url = '%@/%@?user_credentials=%@&%@'.fmt(Global.apiUrl, action, Auth.user.singleAccessToken, params);
            } else {
                url = '%@/%@?user_credentials=%@'.fmt(Global.apiUrl, url, Auth.user.singleAccessToken);
            }
        }
        data = null;
        break;
    case 'PUT':
    case 'POST':
        if (Ember.typeOf(url) === 'regexp') {
            url = new RegExp('%@/%@'.fmt(Global.apiUrl, url.source))
        } else {
            url = '%@/%@'.fmt(Global.apiUrl, url);
        }
        data = {
            user_credentials: Auth.user.single_access_token
        };
        break;
    case 'DELETE':
Ember.Logger.error('Not yet implemented!')
        break;
    }

    api.respondWith(method, url,
        [
            200,
            { "Content-Type": "application/json" },
            message
        ]);
}


var api;

withFakeAPI = {
    setup: function () {
        api = sinon.fakeServer.create();
    },
    teardown: function () {
        api.restore();
    }
};
