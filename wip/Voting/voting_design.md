## For all polls ##
* There are 3 types of polls
  - member update polls - member's parameters change (including proposing new member and firing)
  - contract parameter change
  - bonus distribution


- only Active members can create polls and vote
- if a poll is accepted, process (process<pollType\>Poll()) should be called (anybody could call it) for the voted changes to take effect
- the validity of the proposed in a poll changes is checked at the time of the poll processing not its creation
- active members with voting weight could vote during the voting period, while the poll is active
- polls have validity period which starts at the end of the voting period
- after the validity period the poll expires and could not take effect even if it's been accepted
- after a poll expires, could be deleted to free up space
- after a poll is processed, it is finalized and can't be used anymore
- after a poll is finalized, could be deleted to free up space

A poll could be in one of the following states:
* Unstarted -> Used only for bonus distribution polls where we may need to add more members after
creating the poll. If we haven't added all members in one transaction (ran out of gas or else), we need to
call a separate function (addBonusDitributionPollData()) to add them. We can call this function as many times as
we need until we set isReady parameter = true.
* Active -> Voting has started.
* Accepted -> The proposal was accepted but hasn't yet come into effect. **Should be processed (process<pollType\>Poll() to be called) before the validity period passes, otherwise won't take effect.**
* Rejected -> The proposal was NOT accepted.
* Finalized -> The proposal has been accepted and processed. The poll can now be deleted.
* Expired -> The poll's validity period has passed and could now be deleted. A poll could come to this state from Active, Accepted, Rejected or Finalized.

## Member update polls ##

A *member update poll* is a proposal to change one or more parameters of a member *M*. The member could already be part of the project or one to be invited to join it.

If poll processing fails:
  * *M*'s parameters are NOT updated
  * the poll's state remains Accepted
  * *processMemberUpdatePoll(p)* could be called again (before the poll expires) if the circumstances change (e.g. the project's periods increase or the project receives an extra reward).

If the poll is processed successfully, *M*'s parameters are updated to the accepted ones.

* *M* is an **Active** member
  - The poll becomes Finalized and could be deleted.


* *M* is an **Inactive** member - left the project or was fired, should be Invited again to become an Active member

  - change any of the member's parameters except for the bonus (voting weight, periods, reward per period or one-time reward) - the member is invited to join the project again (if the member is a contract, joins automatically). The poll's state remains Accepted until *join(p)* is called or the poll expires.

  - change bonus - poll becomes Finalized and could be deleted.

* *M* is a new (**Uninitialized or Invited**) member

  - *M* is a contract (subproject) - The member becomes Active. The poll becomes Finalized and could be deleted.

  - *M* is an individual - The member becomes Invited. The poll's state remains Accepted until *join(p)* is called or the poll expires. *M* calls *join(p, ...)* accepting the terms in poll *p*. This also prevents a member from joining after a long period of time. **_join()_ automatically calls *processMemberUpdatePoll()*.** If the accepted proposal is valid and joining doesn't fail, *M* becomes Active with the accepted in *p* parameters. The parameters that are not voted in *p* remain the same (last accepted ones from previous proposals or 0). The poll becomes Finalized and could be deleted.

---

### New member (initial member) ###

A fake member update poll is created containing the initial member's address and parameters. The poll is automatically accepted and the member becomes Invited. The member could join the project before the validity of the poll expires.

### New member (hiring) ###

A *member update poll* for a new member is created containing address, voting weight (for individuals only), number of periods, reward per period, one-time reward and bonus. Only the address is mandatory. Many proposals could be made for an address. If the poll is accepted and **valid**:
* If the proposed member is a contract (not an individual), it becomes a new member with the accepted parameters. If there are more than one proposals, the last accepted will **replace** the previous ones.

  - If the number of periods or reward per period is set, the subproject's parameters should also be updated (?? should subproject members agree and what if they don't). The subproject's members will be affected. There could be a situation where the project's periods are decreased and the members' are not (TODO).


* If the proposed member is an individual, the account is considered Invited. The member's parameters will be updated but since there could be many different proposals, they are not final. To join the project individuals
choose which (accepted) proposal to agree to and become active members of the project. If the accepted proposal expires (the validity period has passed), the member won't be able to call join choosing this particular proposal and should choose another one. Members stay in Invited state until they join. Members are added to the contributors list after they join. Even if they leave the project (or are fired), they are never removed from the list.

* In case that the accepted parameters are invalid (e.g. the number of periods is greater than the project's, reward is greater than what is available), the member stays Invited. If the circumstances change and the voted parameters become valid (e.g. the project's number of periods increases), the proposal could still be processed.


### Changing member's voting weight ###

**If the member is a contract (new or existing member), setting voting weight is impossible and a poll will not be created!**

A *member update poll p* for a member *M* is created containing an address and new voting weight. The member should be an individual. The member could be in any state. The poll is accepted and *processMemberUpdatePoll* is called

* *M* is **Uninitialized, Invited or Inactive**

  *M*'s voting weight is updated. The member becomes Invited. The poll remains Accepted until join(this poll) is called or it expires. Project's total voting weight will be updated when the member joins.

* *M* is **Active**

  *M*'s voting weight is updated. Project's total voting weight is also updated. The poll is Finalized and could be deleted.
  **? Should all active proposals, where the member voted, also be updated?**

### Changing member's periodsLeft ###

A *member update poll p* for a member *M* is created containing *M*'s' address and periods *k*. Project's periodsLeft is *n*, *M*'s current periodsLeft is *c*. The member could be in any state. The poll is accepted and *processMemberUpdatePoll* is called

* *k* > *n*
A project can't hire for more periods than it has itself. The transaction fails. *processMemberUpdatePoll* could be called again if *n* increases.

* *k* == *n*
A project could hire for all its *n* periods only if it hasn't started yet.

  - The project is in the middle of a period therefore could only hire new members for the unstarted periods (*n* - 1 periods) -> accepted parameters are invalid and the transaction fails.

  - The project hasn't started yet therefore could hire members for all the *n* periods -> the poll is processed.

* *k* < *n*

  * *k* > *c*
  The poll is processed. *M*'s periods are increased.

  * *k* < *c*

    - *k* >= 1

    The poll is processed. *M*'s periods are decreased.

    - *k* == 0:

    Could not reduce a member's periods to zero in the middle of a period.
    If *M* is in the middle of a period - the transaction fails!
    If *M* hasn't yet started their first period - the poll is processed.

    **TODO** What should happen if the member is a contract and its members are hired for > *k* periods?

If **_c_ == 0** and *M* has just been hired for some periods, the member's first period will be the project's next one. The member could claim their first period reward after the end of their first period.

### Changing member's rewardPerPeriod ###

A *member update poll p* for a member *M* is created containing an address and rewardPerPeriod *r*. The
project's periodsLeft is *n*. The member could be in any state. To receive rewards per period, a member's periodsLeft must be set. The poll is accepted and *processMemberUpdatePoll* is called

1. *M*'s periodsLeft == 0
  - The poll is processed.
  - When an increase in periodsLeft is accepted and the member is an Active one, the change will happen only if the project is able to pay the reward.


2. *M*'s periodsLeft > 0 and Active

  * The project can't afford to pay the reward (e.g. *r* is greater than what is available) - The transaction fails.

  * The project has the resources to pay the reward - The poll is processed - rewardPerPeriod is updated

3. *M* is Uninitialized, Invited or Inactive

  * *M* is a contract (subproject) -
    - The project can't afford to pay the reward (e.g. *r* is greater than what is available) - The transaction fails.

    - The project has the resources to pay the reward - The poll is processed. *rewardPerPeriod* is updated. *M* becomes an Active member. The poll becomes Finalized and could be deleted.

  * *M* is an individual - *rewardPerPeriod* is updated. *M* becomes an Invited member. The poll's state remains Accepted until *join(p)* is called or the poll expires. Joining will fail if the project can't pay the reward.

A reward for a period could be claimed and withdrawn at the end of the period.

---
Case:

If a contract has *periodsLeft* set, but does not receive reward per month, only one-time rewards, it returns
the unused one-time rewards after the periods pass. If such a contract starts receiving rewards per period, it
will return the unused rewards when it claims its reward per period from the sponsor (instead of at the end of
all periods). If there are members with rewards per period, the project's reward per period could be lower
than the sum of its members' rewards. (TODO)

---

Examples:

1. Project A (10/m *n* periods)
  - Individual B (3/m *n* periods)
  - Individual C (5/m *n* periods)

  The project could afford to give up to 2k (project's reward - individuals' rewards = 10 - 3 - 5 = 2k) as another reward per period.

  A *member update poll p* is created for a member *M* with a rewardPerPeriod *r*, *r* <= 2k, for some periods *s*, 0 < *s* < *n*, if project is in the middle of a period, 0 < *s* <= *n*, if the project hasn't started yet.

  *M* becomes Active with rewardPerPeriod = *r*, periodsLeft = *s* and nextClaimDate = *t* + the length of 1 period, if project has started or *t*, if the project hasn't started yet. *t* is the project's nextClaimDate.
  *M* could claim and withdraw the reward on or after nextClaimDate.

2. Project A (10/m 3 periods)
  - Individual B (3/m 3 periods)
  - Individual C (5/m 1 period)

  We want to hire a new member *M* with a reward per period *r*.

  Case 1: The project hasn't started yet. We could hire *M* for 1 to 3 periods with *r* <= 2k (10k - 3 - 5).

  Case 2: The project has started and is in the first period. We could hire *M* for 1 or 2 periods with *r* <= 2k (10k - 3 - 5).

  Case 3: The project is in the second period, *C* claimed their reward. The project now looks like this:

  - Project A (10/m 2 periods)
    - Individual B (3/m 2 periods)
    - Individual C (5/m 0 period)

  We could hire *M* for only one period - the third period - since the second one has already started - and *r* could be up to 7k (10k - 3k). *M* will be able to claim and withdraw the reward at the end of the third period.

  Another option is to give *M* an one-time reward or bonus for the current period (up to 7k) and hire them for the last - third - period of the project with *r* <= 7k.

4. Project A (10/m *n* periods)
  - Individual B (3/m *n* periods)
  - Individual C (5/m *n* periods)

  A proposal to change *C*'s reward from 5 to *r* is accepted.

  - *r* is valid (0 <= *r* <= 7) - the poll is processed.

  - *r* is not valid - the transaction fails!

5. Project A (0/m 3 periods, 30 one-time reward)
  - Individual B (3/m 3 periods)
  - Individual C (5/m 3 periods)

  Project A has started and claimed its one-time reward. A proposal to change *A*'s reward from 0 to *r* is accepted. The poll is processed

  * *r* < 8 (*B*'s + *C*'s rewards) - *B* and *C* won't be able to get their rewards

  **TODO** Proper calculation of available resources of such contracts.


### Changing member's oneTimeReward ###
**To receive one-time rewards, periodsLeft must be set!!!**

**This reward is given for a specific period (current period). Changing an Active member's one-time reward could
only happen after the project claims its reward for the previous period, otherwise it's not known what's
available and if the reward could be paid! Changing the reward will FAIL if it's done(processed) after the
project's claim date but before the actual claiming. This is done for proper calculation and usage of the
project's available resources.**

A *member update poll p* for a member *M* is created containing an address and an one-time reward *r*. The member could be in any state. The poll is accepted and *processMemberUpdatePoll* is called

1. *M*'s periodsLeft == 0
  - The transaction fails!

2. *M*'s periodsLeft > 0 and is Active

  * The project can't afford to pay the reward (e.g. *r* is greater than what is available) - The transaction fails.

  * The project has the resources to pay the reward - The poll is processed. *M*'s *oneTimeReward* is updated. The poll becomes Finalized and could be deleted.

3. *M* is Uninitialized, Invited or Inactive

  * *M* is a contract (subproject)
    - The project can't afford to pay the reward (e.g. *r* is greater than what is available) - The transaction fails.

    - The project has the resources to pay the reward - The poll is processed. *M*'s *oneTimeReward* is updated. The member becomes Active. The poll becomes Finalized and could be deleted.

  * *M* is an individual
    - The poll is processed. *M*'s *oneTimeReward* is updated. The member becomes Invited. The poll's state remains Accepted until *join(p)* is called or the poll expires. Joining will fail if the project can't pay the reward.


**One-time rewards should be claimed during the same project's period or will be lost!**

---

Examples:

1. Project A (10k/m 4 periods)
  - Individual B (3k/m 4 periods)
  - Individual C (5k/m 4 periods)

  The project has started, already claimed and withdrawn its first period reward and has extra 2k (project's reward - individuals' rewards = 10 - 3 - 5 = 2k) - the project could pay up to 2k rewards. Since the project is in its second period, it could hire new members only for the third and fourth periods.
  A proposal is made for a new member *M* for 2 periods(last 2) and an one-time reward *r* <= 2k. Reward per period for *M* is 0. The proposal is accepted.

  *M* calls *join(p, ...)* accepting the terms in poll *p*. *M* becomes an Active member with *oneTimeReward* = *r* and *periodsLeft* = 2 (project's third and fourth).

  *M* claims the one-time reward before the end of the current period (the project's second period).

2. Project A (10k/m 4 periods, 500k one-time reward)
  - Individual B (3k/m 4 periods)
  - Individual C (5k/m 4 periods)

  A proposal is made for a new member *M* for some periods and one-time reward *r*.

  Case 1. The project hasn't started yet or started and is in its first period. It has claimed its one-time reward - *r* could be <= 500k

  Case 2. The project has started its second period, claimed the reward for the first one, but lost the one-time reward since it didn't claim it earlier - *r* could be <= 2k (project's reward - individuals' rewards = 10 - 3 - 5 = 2k)

  Case 3. The project has started its second period, has claimed the reward for the first one and the one-time reward - *r* could be <= 500k + 2k

### Changing member's bonus ###

A *member update poll p* for a member *M* is created containing an address and bonus *b*. The member could be in any state. The poll is accepted and *processMemberUpdatePoll* is called

  * *M* is already a member of the project - present in the contributors list - could be Active, Inactive or Invited (left the project but Invited to join it again)

  - The project can't afford to pay the reward (e.g. *b* is greater than what is available) - The transaction fails.

  - The project has the resources to pay the reward - The poll is processed
    *b* **is added to** *M*'s current bonus. The bonus could be claimed and withdrawn at any time.
    **Accepting a bonus change will not cause an Inactive member to be invited again!**

  * *M* is not a member of the project yet - not present in the contributors list - could be Uninitialized or Invited
  *b* **replaces** *M*'s current bonus. *M* becomes Invited (or joins automatically if is a contract). The bonus could be claimed and withdrawn after the member joins the project. Joining will fail if the project can't pay the reward.

**Bonuses are never returned to the sponsor!**  

**!!! For existing members the new bonus is ADDED to their current one, does NOT REPLACE it! Be careful of the case where there are many accepted proposals for a new member containing bonus, the member joins, processing one of them, and becomes an Active member - processing the others will cause the bonuses to sum up (if the sum is valid / available). !!!**

 ---

Examples:

1. Project A (10k/m 3 periods)
  - Individual B (3k/m 3 periods)
  - Individual C (5k/m 3 periods)

  The project has started and already claimed and withdrawn its first period reward and has extra 2k (project's reward - individuals' rewards = 10 - 3 - 5 = 2k) - the project could pay up to 2k extra bonus.

2. Project A (10k/m 3 periods + 500k one-time reward)
  - Individual B (3k/m 3 periods)
  - Individual C (5k/m 3 periods)

  * Case 1: The project hasn't started yet but claimed and withdrawn its one-time reward of 500k - the project could pay up to 500k extra rewards - bonus could be up to 500k

  * Case 2: The project has started its second period, claimed the reward for the first one, but lost the one-time reward because it didn't claim it earlier - bonus could be <= 2k (project's reward - individuals' rewards = 10 - 3 - 5 = 2k)

  * Case 3: The project has started its second period, claimed the reward for the first one and the one-time reward - bonus could be <= 500k + 2k

### Removing a member (firing) / Leaving the project ###

A proposal *p* for a member *M* is created containing an address and the boolean parameter *toRemove* set to true. The member could be in any state. The poll is accepted and *processMemberUpdatePoll* is called

* *M* is  **Active** or **Invited** but present in the contributors list (meaning member has left the project or has been fired but invited again)
  - *M* becomes Inactive. Inactive members can't make proposals and can't vote. To become Active
  again, an Inactive member should be invited again and then join (again) / accept the new terms.
  If the member has voting weight, the project's total voting weight is updated. Inactive members
  can't claim rewards per period or one-time rewards but can claim bonuses. The poll is processed,
  becomes Finalized and could be deleted.

* *M* is **Invited** but not present in the contributors list
  - *M* becomes Uninitialized - invitation is withdrawn

* *M* is **Inactive** or **Uninitialized**
  - The poll is processed but has no effect!

## Bonus distribution ##

1. Create a poll for bonus distribution passing a list of contributors and a list of values, where
the first value is what the first contributor from the list will receive as a bonus, second value -
second contributor and so on. The contributors from the list must be present in the project's contributors
list - must have joined the project. We could add more contributors later until we are ready with the poll.
2. If the poll is accepted, the values are added as bonuses to the contributors. If there are too many
contributors, the poll could be processed on as many steps as needed. It becomes Finalized after all the
contributors from the list have received their bonuses.

**A bonus distribution poll cannot be processed while another one is in progress to prevent errors!**

---

Examples:

Case 1. Small number of contributors

Project *A* has contributors list [1, 2, 3, ... , 64]. *A* has received a bonus *b*. A proposal for bonus distribution is created where every contributor receives equal part of the bonus. Since the contributors are not too many, the poll could be created in one step.

```solidity
// createBonusDitributionPoll(address[] memory_contributors, uint256[] memory_values, bool _isReady);
createBonusDitributionPoll([1, 2, 3, ... , 64], [b/64, b/64 ....], true);
```

The proposal is accepted and processed. While processing, *b*/64 is added to every contributor's current bonus. Since there are only 64 contributors, processing happens in one step - *processBonusDitributionPoll(p)*.

Case 2. Large number of contributors

Project *A* has contributors list [1, 2, 3, ... , *n*]. *n* is a larger number. *A* has received a bonus *b*. A poll for bonus distribution is created where every contributor receives equal part of the bonus.

```solidity
// createBonusDitributionPoll(address[] memory_contributors, uint256[] memory_values, bool _isReady);
createBonusDitributionPoll([1, 2, 3, ... , 100], [b/n, b/n ....], false);
createBonusDitributionPoll([101, 102, 103, ... , 200], [b/n, b/n ....], false);
...
createBonusDitributionPoll([... , n], [b/n, b/n ....], true);
```

The proposal is accepted and processed. While processing, *b*/*n* is added to every contributor's
current bonus. Since there are too many contributors, processing happen in more than one steps -
*processBonusDitributionPoll* should be called *n*/64 times. Processing another bonus distribution
poll won't be possible while this one is being processed (between the fist and last call
of *processBonusDitributionPoll(p)*).

## Contract parameter change ##

**Version 2**
