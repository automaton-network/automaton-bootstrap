/**
 * Use this file to configure your truffle project. It's seeded with some
 * common settings for different networks and features like migrations,
 * compilation and testing. Uncomment the ones you need or modify
 * them to suit your project as necessary.
 *
 * More information about configuration can be found at:
 *
 * truffleframework.com/docs/advanced/configuration
 *
 * To deploy via Infura you'll need a wallet provider (like truffle-hdwallet-provider)
 * to sign your transactions before they're sent to a remote public node. Infura API
 * keys are available for free at: infura.io/register
 *
 * You'll also need a mnemonic - the twelve word phrase the wallet uses to generate
 * public/private key pairs. If you're publishing your code to GitHub make sure you load this
 * phrase from a file you've .gitignored so it doesn't accidentally become public.
 *
 */

const fs = require('fs');

// Only necessary when launching outside Ganache.
/*
const HDWalletProvider = require('truffle-hdwallet-provider');
const mnemonic = fs.readFileSync("mnemonic.secret").toString().trim();
const infuraKey = fs.readFileSync("infuraKey.secret").toString().trim();
*/

module.exports = {

  networks: {
    // Useful for testing. The `development` name is special - truffle uses it by default
    // if it's defined here and no other network is specified at the command line.
    // You should run a client (like ganache-cli, geth or parity) in a separate terminal
    // tab if you use this network and you must also set the `host`, `port` and `network_id`
    // options below to some value.
    //
    development: {
      host: "127.0.0.1",     // Localhost (default: none)
      port: 7545,            // Standard Ethereum port (default: none)
      network_id: "*",       // Any network (default: none)
      accounts: 10,
      defaultEtherBalance: 1000
    },

    ganache: {
      host: "127.0.0.1",
      port: 7545,
      network_id: "*",
      gas: 5500000,          // Ropsten has a lower block limit than mainnet
      gasPrice: 1000000000,  // 3 gwei (in wei) (default: 100 gwei)
    },

    aws: {
      host: "54.174.16.2",   // For testing purposes only, not a static IP! Subject to change!
      port: 7545,
      network_id: "*",
      gasPrice: 3000000000,  // 3 gwei (in wei) (default: 100 gwei)
    },
  },

  // Set default mocha options here, use special reporters etc.
  mocha: {
    timeout: 100000
  },

  // Configure your compilers
  compilers: {
    solc: {
      version: "0.6.2",   // Fetch exact version from solc-bin (default: truffle's version)
      docker: false,
      settings: {
        optimizer: {
          enabled: true,
          runs: 200
        },
        evmVersion: "petersburg"
      }
    }
  }
}
