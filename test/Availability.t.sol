// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "solmate/tokens/ERC20.sol";
import {BallastVault} from "../src/BallastVault.sol";
import {IOutcomeToken} from "../src/interfaces/IOutcomeToken.sol";
import {IBinarySettlement} from "../src/interfaces/IBinarySettlement.sol";
import {
    MockCollateral, MockOutcomeToken, MockBinaryPool, MockSettlement, RevertingPool, GasBombPool
} from "./mocks/Mocks.sol";

/**
 * Can the vault be made unusable?
 *
 * `legTotals` walks every allowlisted pool and makes two external calls each,
 * and nav / sharePrice / deposit / withdraw / every operator action all go
 * through it. One misbehaving pool in that list therefore has the whole vault
 * downstream of it — including the exit.
 */
contract AvailabilityTest is Test {
    MockCollateral usd;
    MockOutcomeToken outcome;
    MockBinaryPool pool;
    MockSettlement settlement;
    BallastVault vault;

    address alice = address(0xA11CE);
    uint256 constant ONE = 1e6;

    function setUp() public {
        usd = new MockCollateral(6);
        outcome = new MockOutcomeToken();
        pool = new MockBinaryPool(usd, outcome, 1, 2);
        settlement = new MockSettlement(usd, outcome);
        vault = new BallastVault(
            ERC20(address(usd)), IOutcomeToken(address(outcome)),
            IBinarySettlement(address(settlement)), 100 * ONE
        );
        vault.setOperator(address(0xB0B));
        vault.allowPool(address(pool));
        usd.mint(alice, 1_000_000 * ONE);
        pool.seed(1_000_000 * ONE);
        settlement.seed(1_000_000 * ONE);
        vm.prank(alice);
        usd.approve(address(vault), type(uint256).max);
    }

    /// A pool that starts reverting must not take the vault down with it.
    function test_aRevertingPoolDoesNotBrickTheVault() public {
        vm.prank(alice);
        uint256 shares = vault.deposit(1_000 * ONE);

        vault.allowPool(address(new RevertingPool()));

        // The exit is the one thing that must always work.
        vault.nav();
        vm.prank(alice);
        vault.withdraw(shares / 2);
    }

    /// Same, for an address that simply has no code.
    function test_anEmptyAddressAsAPoolDoesNotBrickTheVault() public {
        vm.prank(alice);
        uint256 shares = vault.deposit(1_000 * ONE);

        vault.allowPool(address(0xDEAD)); // no code

        vault.nav();
        vm.prank(alice);
        vault.withdraw(shares / 2);
    }

    /// A pool that eats all the gas must not be able to stall the loop.
    function test_aGasBombPoolDoesNotBrickTheVault() public {
        vm.prank(alice);
        uint256 shares = vault.deposit(1_000 * ONE);

        vault.allowPool(address(new GasBombPool()));

        vm.prank(alice);
        vault.withdraw(shares / 2);
    }
}
