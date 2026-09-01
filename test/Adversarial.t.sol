// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "solmate/tokens/ERC20.sol";
import {BallastVault} from "../src/BallastVault.sol";
import {IOutcomeToken} from "../src/interfaces/IOutcomeToken.sol";
import {IBinarySettlement} from "../src/interfaces/IBinarySettlement.sol";
import {MockCollateral, MockOutcomeToken, MockBinaryPool, MockSettlement} from "./mocks/Mocks.sol";

/**
 * Attacks, not features.
 *
 * Every test here is an attempt to take money out of the vault, brick it, or
 * make it lie about what it holds. A test that FAILS here is a finding.
 */
contract AdversarialTest is Test {
    MockCollateral internal usd;
    MockOutcomeToken internal outcome;
    MockBinaryPool internal pool;
    MockSettlement internal settlement;
    BallastVault internal vault;

    address internal operator = address(0xB0B);
    address internal alice = address(0xA11CE); // honest depositor
    address internal eve = address(0xE7E); // attacker

    uint256 internal constant YES_ID = 1;
    uint256 internal constant NO_ID = 2;
    uint256 internal constant ONE = 1e6; // 6dp, the live testnet venue

    function setUp() public {
        usd = new MockCollateral(6);
        outcome = new MockOutcomeToken();
        pool = new MockBinaryPool(usd, outcome, YES_ID, NO_ID);
        settlement = new MockSettlement(usd, outcome);

        vault = new BallastVault(
            ERC20(address(usd)),
            IOutcomeToken(address(outcome)),
            IBinarySettlement(address(settlement)),
            100 * ONE
        );
        vault.setOperator(operator);
        vault.allowPool(address(pool));

        usd.mint(alice, 1_000_000 * ONE);
        usd.mint(eve, 1_000_000 * ONE);
        pool.seed(1_000_000 * ONE);
        settlement.seed(1_000_000 * ONE);

        vm.prank(alice);
        usd.approve(address(vault), type(uint256).max);
        vm.prank(eve);
        usd.approve(address(vault), type(uint256).max);
    }

    /* ───────────────── share inflation / first depositor ───────────────── */

    /**
     * The classic ERC-4626 inflation attack. Eve is first in with dust, then
     * donates collateral straight to the vault to blow up the share price. If
     * the vault has no defence, Alice's deposit rounds down into Eve's pocket.
     */
    function test_attack_firstDepositorInflation() public {
        vm.prank(eve);
        uint256 eveShares = vault.deposit(1); // 1 raw unit

        // Donate 10,000 collateral directly — not a deposit, so no shares minted.
        vm.prank(eve);
        usd.transfer(address(vault), 10_000 * ONE);

        // Alice now deposits a normal amount.
        vm.prank(alice);
        uint256 aliceShares = vault.deposit(1_000 * ONE);

        // Whatever happens, Alice must be able to get back roughly what she put
        // in. If she cannot, the vault has a live inflation attack.
        uint256 aliceValue = (aliceShares * vault.nav()) / vault.totalSupply();
        uint256 eveValue = (eveShares * vault.nav()) / vault.totalSupply();

        emit log_named_uint("alice deposited ", 1_000 * ONE);
        emit log_named_uint("alice can redeem", aliceValue);
        emit log_named_uint("eve  donated    ", 10_000 * ONE + 1);
        emit log_named_uint("eve  can redeem ", eveValue);

        assertGe(aliceValue, (1_000 * ONE * 99) / 100, "alice lost more than 1% to the first depositor");
    }

    /* ──────────────────── unbounded pool list / gas DoS ───────────────────── */

    /**
     * `legTotals` loops every pool ever allowlisted and makes two external
     * calls each. Deposit, withdraw, nav, sharePrice and every operator action
     * go through it. The venue spawns new pools continuously, so this list only
     * grows — if it grows without bound the vault eventually cannot be used.
     */
    function test_attack_poolListGrowthMakesDepositUnusable() public {
        vm.prank(alice);
        vault.deposit(100 * ONE);

        // Fill to the cap.
        while (vault.poolCount() < vault.MAX_POOLS()) {
            uint256 i = vault.poolCount();
            MockBinaryPool p = new MockBinaryPool(usd, outcome, 1000 + i * 2, 1001 + i * 2);
            vault.allowPool(address(p));
        }

        // One more must be refused rather than growing the loop forever.
        MockBinaryPool extra = new MockBinaryPool(usd, outcome, 90_000, 90_001);
        vm.expectRevert(BallastVault.TooManyPools.selector);
        vault.allowPool(address(extra));

        uint256 before = gasleft();
        vm.prank(alice);
        vault.deposit(1 * ONE);
        uint256 used = before - gasleft();

        emit log_named_uint("pools at cap     ", vault.poolCount());
        emit log_named_uint("gas for a deposit", used);

        assertLt(used, 1_500_000, "deposit gas at the cap is still too high");
    }

    /* ───────────────────────── permissionless redeem ───────────────────────── */

    /**
     * `redeem` is deliberately open to anyone. That is only safe if it cannot
     * destroy a LIVE position — if an unresolved outcome can be burned for
     * nothing, a passer-by can wipe out the vault's inventory for free.
     */
    function test_attack_redeemCannotBurnAnUnresolvedPosition() public {
        vm.prank(alice);
        vault.deposit(1_000 * ONE);

        vm.prank(operator);
        vault.mintSet(address(pool), 50 * ONE);

        uint256 navBefore = vault.nav();

        // Nothing has resolved. Eve tries to burn the vault's inventory.
        vm.prank(eve);
        try vault.redeem(YES_ID, 50 * ONE) {
            // If it went through, the position must not have been destroyed
            // for nothing.
            assertGe(vault.nav(), navBefore, "an unresolved position was burned for zero");
        } catch {
            // Reverting is the correct outcome.
        }
    }

    function test_attack_redeemProceedsCannotBeDiverted() public {
        vm.prank(alice);
        vault.deposit(1_000 * ONE);
        vm.prank(operator);
        vault.mintSet(address(pool), 20 * ONE);

        settlement.setWinner(YES_ID, true);
        uint256 eveBefore = usd.balanceOf(eve);

        vm.prank(eve);
        vault.redeem(YES_ID, 20 * ONE);

        assertEq(usd.balanceOf(eve), eveBefore, "caller pocketed redemption proceeds");
    }

    /* ────────────────────────────── operator ───────────────────────────────── */

    function test_attack_operatorCannotDrainViaAnyReachablePath() public {
        vm.prank(alice);
        vault.deposit(1_000 * ONE);
        uint256 held = usd.balanceOf(address(vault));

        vm.startPrank(operator);
        // Everything the operator may call, aimed at extraction.
        vm.expectRevert();
        vault.withdraw(1); // holds no shares
        vm.expectRevert(BallastVault.PoolNotAllowed.selector);
        vault.mintSet(address(0xBAD), 1 * ONE);
        vm.expectRevert(BallastVault.NotOwner.selector);
        vault.transferOwnership(operator);
        vm.stopPrank();

        assertEq(usd.balanceOf(address(vault)), held, "collateral moved");
    }

    /**
     * A revoked pool drops out of `legTotals`, so any position still held in it
     * silently stops counting toward NAV. The owner should not be able to erase
     * depositor value with one call.
     */
    function test_attack_revokingAPoolWithALivePositionErasesNav() public {
        vm.prank(alice);
        vault.deposit(1_000 * ONE);
        vm.prank(operator);
        vault.mintSet(address(pool), 100 * ONE);

        uint256 navBefore = vault.nav();
        vault.revokePool(address(pool));
        uint256 navAfter = vault.nav();

        emit log_named_uint("nav before revoke", navBefore);
        emit log_named_uint("nav after  revoke", navAfter);
        assertEq(navAfter, navBefore, "revoking a pool erased NAV that still exists");
    }

    function test_purgePool_refusesWhileThePoolStillHoldsSomething() public {
        vm.prank(alice);
        vault.deposit(1_000 * ONE);
        vm.prank(operator);
        vault.mintSet(address(pool), 10 * ONE);

        vm.expectRevert(BallastVault.PoolNotEmpty.selector);
        vault.purgePool(address(pool));
    }

    function test_purgePool_freesASlotOnceEmpty() public {
        vm.prank(alice);
        vault.deposit(1_000 * ONE);
        uint256 before = vault.poolCount();

        vault.purgePool(address(pool));
        assertEq(vault.poolCount(), before - 1, "slot freed");
        assertFalse(vault.poolAllowed(address(pool)), "and trading stopped");
    }

    /* ──────────────────────────── ownership ────────────────────────────────── */

    function test_attack_ownershipCannotBeBurned() public {
        vm.expectRevert();
        vault.transferOwnership(address(0));
        assertEq(vault.owner(), address(this), "owner survived");
    }

    /* ──────────────────────────── rounding ─────────────────────────────────── */

    function testFuzz_noDepositWithdrawCycleEverProfits(uint96 seed, uint96 amt) public {
        vm.prank(alice);
        vault.deposit(bound(uint256(seed), ONE, 10_000 * ONE));

        uint256 amount = bound(uint256(amt), ONE / 100 + 1, 10_000 * ONE);
        uint256 before = usd.balanceOf(eve);

        vm.startPrank(eve);
        uint256 shares = vault.deposit(amount);
        vault.withdraw(shares);
        vm.stopPrank();

        assertLe(usd.balanceOf(eve), before, "a round trip made money out of nothing");
    }
}
