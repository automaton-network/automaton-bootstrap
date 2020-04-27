var KingAutomaton = artifacts.require("KingAutomaton");
var Util = artifacts.require("Util");
var DEX = artifacts.require("DEX");
var KingOfTheHill = artifacts.require("KingOfTheHill");
var Proposals = artifacts.require("Proposals");

module.exports = function(deployer) {
  deployer.deploy(Util);
  deployer.link(Util, KingOfTheHill);
  deployer.link(Util, KingAutomaton);
  deployer.link(Util, Proposals);
  deployer.deploy(DEX);
  deployer.link(DEX, KingAutomaton);
  deployer.deploy(Proposals);
  deployer.link(Proposals, KingAutomaton);

  _numSlots = 256;
  _minDifficultyBits = 16;
  _predefinedMask = "0x10000";
  _initialDailySupply = "406080000";
  _approvalPct = 10;
  _contestPct = -10;
  _treasuryLimitPct = 2;
  _proposalsInitialPeriod = 7;
  _proposalsContestPeriod = 7;
  _proposalsMinPeriodLen = 3;
  _timeUnitInSeconds = 24 * 60 * 60;  // 1 day

  deployer.deploy(KingAutomaton, _numSlots, _minDifficultyBits, _predefinedMask, _initialDailySupply, _approvalPct,
      _contestPct, _treasuryLimitPct, _proposalsInitialPeriod, _proposalsContestPeriod, _proposalsMinPeriodLen,
      _timeUnitInSeconds);
};
