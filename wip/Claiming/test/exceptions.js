const PREFIX = "Returned error: VM Exception while processing transaction: ";

async function tryCatch(promise, message, reason) {
  try {
    await promise;
    throw null;
  } catch (error) {
      assert(error, "Expected an error with message '[" + reason + "] " + message + " but did not get one");
      if (typeof(reason) == 'string') {
        assert(error.message.endsWith("Reason given: " + reason + "."),
          "Expected an error ending with 'Reason given: " + reason + "." +
          "' but got '" + error.message + "' instead");
      }
      assert(error.message.startsWith(PREFIX + message),
          "Expected an error starting with '" + PREFIX + message + "' but got '" + error.message + "' instead");
  }
};

module.exports = {
  catchRevert            : async function(promise, reason) {await tryCatch(promise, "revert"              , reason);},
  catchOutOfGas          : async function(promise, reason) {await tryCatch(promise, "out of gas"          , reason);},
  catchInvalidJump       : async function(promise, reason) {await tryCatch(promise, "invalid JUMP"        , reason);},
  catchInvalidOpcode     : async function(promise, reason) {await tryCatch(promise, "invalid opcode"      , reason);},
  catchStackOverflow     : async function(promise, reason) {await tryCatch(promise, "stack overflow"      , reason);},
  catchStackUnderflow    : async function(promise, reason) {await tryCatch(promise, "stack underflow"     , reason);},
  catchStaticStateChange : async function(promise, reason) {await tryCatch(promise, "static state change" , reason);},
};
