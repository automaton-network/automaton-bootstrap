var Project = artifacts.require("ProjectClaiming");
var TestSponsor = artifacts.require("TestSponsor");

module.exports = function(deployer) {
  _nextClaimDate = 0;
  _periodsLeft = 3;
  _rewardPerPeriod = 0;
  _oneTimeReward = 0;
  _bonus = 0;

  deployer.then(function() {
    return deployer.deploy(TestSponsor,
        _nextClaimDate, _periodsLeft, _rewardPerPeriod, _oneTimeReward, _bonus);
  }).then(function(sponsor) {
    deployer.deploy(Project,
        sponsor.address, _periodsLeft, _rewardPerPeriod, _nextClaimDate);
  });
};
