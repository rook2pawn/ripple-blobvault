var response = require('response');
var Queue = require('queuelib');
var config = require('../config');
var libutils = require('../lib/utils')

exports.store; 
var q = new Queue;
var create = function (req, res) {
    var blobId = req.body.blob_id;
    if ("string" !== typeof blobId) {
        process.nextTick(function() {
            throw { res : res , error : new Error("No blob ID given.")};
        })
        return;
    } else {
        blobId = blobId.toLowerCase();
    }

    if (!/^[0-9a-f]{64}$/.exec(blobId)) {
        process.nextTick(function() {
          throw { res : res, error : new Error("Blob ID must be 32 bytes hex.") }
        });
       return;
    }

    var username = req.body.username;
    if ("string" !== typeof username) {
        process.nextTick(function() {
            throw { res : res , error : new Error("No username given.") }
        });
        return;
    } 
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,13}[a-zA-Z0-9]$/.exec(username)) {
        process.nextTick(function() {
            throw { res : res , error : new Error("Username must be between 2 and 15 alphanumeric" + " characters or hyphen (-)." + " Can not start or end with a hyphen.")}
        });
        return;
    }
    if (/--/.exec(username)) {
        process.nextTick(function() {
            throw { res : res, error : new Error("Username cannot contain two consecutive hyphens.")}
        });
        return;
    }

    if (config.reserved[username.toLowerCase()]) {
        process.nextTick(function() {
            throw { res : res, error : new Error("This username is reserved for "+config.reserved[username.toLowerCase()]+'.')}
        });
        return;
    }

    var authSecret = req.body.auth_secret;
    if ("string" !== typeof authSecret) {
        process.nextTick(function() {
            throw { res : res, error : new Error("No auth secret given.") }
        });
        return;
    }

    authSecret = authSecret.toLowerCase();
    if (!/^[0-9a-f]{64}$/.exec(authSecret)) {
        process.nextTick(function() {
            throw { res : res, error : new Error("Auth secret must be 32 bytes hex.") }
        });
        return;
    }

    if (req.body.data === undefined) {
        process.nextTick(function() {
            throw { res : res, error : new Error("No data provided.") }
        });
        return;
    }

    if (req.body.address == undefined) {
        process.nextTick(function() {
            throw { res : res, error : new Error("No ripple address provided.") }
        });
        return;
    } 

    if (req.body.email == undefined) {
        process.nextTick(function() {
            throw { res : res, error : new Error("No email address provided.") }
        });
        return;
    } 

    // XXX Ensure blob does not exist yet

    // XXX Check account "address" exists

    // XXX Ensure there is no blob for this account yet

// do we need to check for reserved here?
    q.series([
    function(lib,id) {
        exports.store.read({username:username},function(resp) {
            if (resp.result == 'no such user') {
                lib.done();
            } else {
                process.nextTick(function() {
                    throw { res : res, error : new Error("User already exists.") }
                });
                lib.terminate(id);
                return;
            }
       });
    },
    function(lib) { 
        // XXX Check signature

        // TODO : inner key is required on updates
        var params = {
            data:req.body.data,
            authSecret:authSecret,
            blobId:blobId,
            address:req.body.address,
            username:username,
            emailVerified:false,
            email:req.body.email,
            emailToken:libutils.generateToken()
        };
        exports.store.create(params,function(resp) {
            if (resp.err) {
                process.nextTick(function() {
                    throw { res : res, error : new Error("problem with create")}
                });
                return;
            }
            response.json({result:'success'}).pipe(res);
            lib.done();
        });
    }
    ]);
};
exports.create = create;
var patch = function (req, res) {
    res.set({
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*'
    });

    // XXX Check HMAC

    // XXX Check patch size

    // XXX Check quota

    db.query(
      "SELECT `id`, `revision` FROM `blob` WHERE `id` = ?", null,
      { raw: true }, [req.body.blob_id]
    )
      .complete(function (err, rows) {
        if (err) {
          handleException(res, err);
          return;
        }

        // XXX Check blob exists

        var blob = rows[0];

        db.query(
          "SELECT `revision` FROM `blob_patches` WHERE `blob_id` = ? " +
          "ORDER BY `revision` DESC " +
          "LIMIT 0,1", null,
          { raw: true }, [req.body.blob_id]
        )
          .complete(function (err, rows) {
            if (err) {
              handleException(res, err);
              return;
            }

            // XXX Race condition: another revision might get added at same time

            var lastRevision = +(rows.length ? rows[0].revision : blob.revision);

            // XXX Handle invalid base64

            var patch = new Buffer(req.body.patch, 'base64');

            db.query(
              "INSERT INTO `blob_patches` (`blob_id`, `revision`, `data`) " +
              "  VALUES (?, ?, ?)", null,
              { raw: true }, [req.body.blob_id, lastRevision + 1, patch])
              .complete(function (err) {
                if (err) {
                  handleException(res, err);
                  return;
                }

                res.json({
                  result: 'success',
                  revision: lastRevision + 1
                });
              }
            );
          }
        );
      }
    );
};

var consolidate = function (req, res) {
    res.set({
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*'
    });

    // XXX Check blob exists

    // XXX Check HMAC

    // XXX Check quota

    var data = new Buffer(req.body.data, 'base64');

    db.query(
      "START TRANSACTION;" +
      "UPDATE `blob` SET `data` = ?, `revision` = ? WHERE `id` = ?;" +
      "DELETE FROM `blob_patches` WHERE `blob_id` = ? AND `revision` <= ?;" +
      "COMMIT;", null,
      { raw: true }, [data, req.body.revision, req.body.blob_id,
                      req.body.blob_id, req.body.revision])
      .complete(function (err) {
        if (err) {
          handleException(res, err);
          return;
        }

        res.json({
          result: 'success'
        });
      }
    );
};

var _delete = function (req, res) {
    res.set({
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*'
    });

    // XXX Check blob exists

    // XXX Check HMAC

    db.query(
      "START TRANSACTION;" +
      "DELETE FROM `blob` WHERE `id` = ?;" +
      "DELETE FROM `blob_patches` WHERE `blob_id` = ?;" +
      "COMMIT;", null,
      { raw: true }, [req.body.blob_id, req.body.blob_id])
      .complete(function (err) {
        if (err) {
          handleException(res, err);
          return;
        }

        res.json({
          result: 'success'
        });
      }
    );
};

var get = function (req, res) {
    res.set({
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*'
    });

    // XXX Check blob exists

    // XXX Check HMAC

    db.query(
      "SELECT data, revision FROM `blob` WHERE `id` = ?", null,
      { raw: true }, [req.params.blob_id])
      .complete(function (err, rows) {
        if (err) {
          handleException(res, err);
          return;
        }

        if (rows.length) {
          var blob = rows[0];
          db.query(
            "SELECT `data` FROM `blob_patches` WHERE `blob_id` = ?" +
            "  ORDER BY `revision` ASC", null,
            { raw: true }, [req.params.blob_id])
            .complete(function (err, rows) {
              if (err) {
                handleException(res, err);
                return;
              }

              // XXX Ensure patches are sequential starting with blob.revision+1

              res.json({
                result: 'success',
                blob: blob.data.toString('base64'),
                revision: blob.revision,
                patches: rows.map(function (patch) {
                  return patch.data.toString('base64');
                })
              });
            }
          );
        } else {
          handleException(res, new Error("Blob not found"));
        }
      }
    );
};


var getPatch = function (req, res) {
    res.set({
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*'
    });

    // XXX Check blob exists

    // XXX Check HMAC

    db.query(
      "SELECT `data` FROM `blob_patches`" +
      "WHERE `blob_id` = ? AND `revision` = ?", null,
      { raw: true }, [req.params.blob_id, req.params.patch_id])
      .complete(function (err, result) {
        if (err) {
          handleException(res, err);
          return;
        }

        if (result.rows.length) {
          res.json({
            result: 'success',
            patch: result.rows[0].data // XXX Convert to base64
          });
        } else {
          // XXX Handle error
        }
      }
    );
};

