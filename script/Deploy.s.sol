// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ERC20} from "solmate/tokens/ERC20.sol";
import {BallastVault} from "../src/BallastVault.sol";
import {IOutcomeToken} from "../src/interfaces/IOutcomeToken.sol";

/**
 * Deploy BallastVault.
 *
 *   forge script script/Deploy.s.sol:Deploy \
 *     --rpc-url somnia_testnet --broadcast --private-key $PRIVATE_KEY
 *
 * Addresses are the verified DreamDEX deployment. The outcome token is a single
 * ERC-6909 singleton shared by every market on the network — confirmed against
 * four live testnet markets, all reporting the same address.
 */
contract Deploy is Script {
    // ── Somnia testnet (chainId 50312) ──
    address constant TESTNET_COLLATERAL = 0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E; // tUSDC, 6dp
    address constant TESTNET_OUTCOME_TOKEN = 0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9;

    // ── Somnia mainnet (chainId 5031) ──
    address constant MAINNET_COLLATERAL = 0x00000022dA000002656c64D9eA6011ea952D008A; // USDso, 18dp

    function run() external returns (BallastVault vault) {
        uint256 chainId = block.chainid;

        address collateral;
        address outcomeToken;
        uint256 cap;

        if (chainId == 50312) {
            collateral = TESTNET_COLLATERAL;
            outcomeToken = TESTNET_OUTCOME_TOKEN;
            // 6dp: 50 tUSDC of one-sided exposure before the vault stops quoting.
            cap = 50e6;
        } else if (chainId == 5031) {
            collateral = MAINNET_COLLATERAL;
            // Read this off a live market before deploying — see script comments.
            outcomeToken = vm.envAddress("OUTCOME_TOKEN");
            cap = 50e18; // 18dp
        } else {
            revert("unsupported chain");
        }

        // Sanity: refuse to deploy against an address with no code. A typo here
        // produces a vault that silently reports a zero position forever.
        require(collateral.code.length > 0, "collateral has no code");
        require(outcomeToken.code.length > 0, "outcomeToken has no code");

        vm.startBroadcast();
        vault = new BallastVault(ERC20(collateral), IOutcomeToken(outcomeToken), cap);
        vault.setOperator(msg.sender);
        vm.stopBroadcast();

        console2.log("BallastVault ", address(vault));
        console2.log("  chainId    ", chainId);
        console2.log("  collateral ", collateral);
        console2.log("  outcome    ", outcomeToken);
        console2.log("  operator   ", msg.sender);
        console2.log("  cap        ", cap);
    }
}
