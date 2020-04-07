#!/bin/bash

truffle --network ganache deploy --reset && truffle --network ganache console  # --verbose-rpc
# koh = await KingAutomaton.deployed()
# koh.getMask().then(r=>{console.log(r.toString(16))})
