// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "solmate/tokens/ERC20.sol";
import {BallastVault} from "../src/BallastVault.sol";
import {IOutcomeToken} from "../src/interfaces/IOutcomeToken.sol";
import {MockCollateral, MockOutcomeToken, MockBinaryPool} from "./mocks/Mocks.sol";

/**
 * Every test here maps to a numbered invariant in ARCHITECTURE.md §13.
 * The suite runs twice — once at 6 decimals (testnet) and once at 18
 * (mainnet) — because the decimal difference between the two networks is the
 * most likely source of a catastrophic bug in this codebase (§3.3).
 */
abstract contract VaultTestBase is Test {
    MockCollateral internal usd;
    MockOutcomeToken internal outcome;
    MockBinaryPool internal pool;
    BallastVault internal vault;

    address internal owner = address(this);
    address internal operator = address(0xB0B);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0BB1E);

    uint256 internal constant YES_ID = 1;
    uint256 internal constant NO_ID = 2;

    uint8 internal dec;
    uint256 internal one;

    function _setUpWithDecimals(uint8 d) internal {
        dec = d;
        one = 10 ** d;

        usd = new MockCollateral(d);
        outcome = new MockOutcomeToken();
        pool = new MockBinaryPool(usd, outcome, YES_ID, NO_ID);

        vault = new BallastVault(ERC20(address(usd)), IOutcomeToken(address(outcome)), 100 * one);
        vault.setOperator(operator);
        vault.allowPool(address(pool), YES_ID, NO_ID);

        usd.mint(alice, 1_000_000 * one);
        usd.mint(bob, 1_000_000 * one);
        pool.seed(1_000_000 * one);

        vm.prank(alice);
        usd.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        usd.approve(address(vault), type(uint256).max);
    }

    function _deposit(address who, uint256 amount) internal returns (uint256) {
        vm.prank(who);
        return vault.deposit(amount);
    }

    /* ───────────────────── invariant 1 — set conservation ──────────────────── */

    function test_mintThenBurn_returnsExactlyTheCollateral() public {
        _deposit(alice, 1_000 * one);
        uint256 before = usd.balanceOf(address(vault));

        vm.prank(operator);
        vault.mintSet(address(pool), 50 * one);

        (uint256 yes, uint256 no) = vault.legTotals();
        assertEq(yes, 50 * one, "yes leg");
        assertEq(no, 50 * one, "no leg");
        assertEq(vault.imbalance(), 0, "a fresh set is perfectly matched");
        assertEq(usd.balanceOf(address(vault)), before - 50 * one, "collateral left the vault");

        vm.prank(operator);
        vault.burnSet(address(pool), 50 * one);

        assertEq(usd.balanceOf(address(vault)), before, "burnSet returns exactly what mintSet took");
        assertEq(vault.imbalance(), 0);
    }

    function testFuzz_mintBurnRoundTrip_isExact(uint96 raw) public {
        _deposit(alice, 1_000 * one);
        uint256 amount = bound(uint256(raw), 1, 500 * one);
        uint256 before = usd.balanceOf(address(vault));

        vm.startPrank(operator);
        vault.mintSet(address(pool), amount);
        vault.burnSet(address(pool), amount);
        vm.stopPrank();

        assertEq(usd.balanceOf(address(vault)), before, "round trip is lossless at any size");
    }

    /* ───────────────────── invariant 2 — imbalance bound ───────────────────── */

    function test_mintingASetCannotChangeTheImbalance() public {
        _deposit(alice, 1_000 * one);

        vm.startPrank(operator);
        vault.mintSet(address(pool), 100 * one);
        assertEq(vault.imbalance(), 0, "both legs moved together");
        vault.mintSet(address(pool), 250 * one);
        assertEq(vault.imbalance(), 0, "still together, at any size");
        vm.stopPrank();
    }

    /**
     * The cap has to bind BEFORE an order exists, because an imbalance is
     * created by a fill and a fill never calls this contract. So the guard is
     * forward-looking: refuse any order that could breach the cap if it filled
     * in full.
     */
    function test_placeOrder_refusesAnOrderThatCouldBreachTheCap() public {
        _deposit(alice, 1_000 * one);
        // cap is 100 * one
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(BallastVault.ImbalanceCapExceeded.selector, 101 * one, 100 * one)
        );
        vault.placeOrder(address(pool), false, 0, 6 * one / 10, 101 * one, 0, 0, 0);
    }

    function test_placeOrder_allowsAnOrderThatFitsUnderTheCap() public {
        _deposit(alice, 1_000 * one);
        vm.prank(operator);
        vault.placeOrder(address(pool), false, 0, 6 * one / 10, 100 * one, 0, 0, 0);
        assertEq(pool.orderCount(), 1, "order went through");
    }

    function test_placeOrder_capTightensAsTheImbalanceGrows() public {
        _deposit(alice, 1_000 * one);

        // Take on 60 of one-sided exposure.
        vm.prank(operator);
        vault.mintSet(address(pool), 60 * one);
        pool.fillAsk(address(vault), YES_ID, 60 * one, 36 * one);
        assertEq(vault.imbalance(), 60 * one);

        // 40 more still fits; 41 does not.
        vm.startPrank(operator);
        vault.placeOrder(address(pool), false, 0, 6 * one / 10, 40 * one, 0, 0, 0);
        vm.expectRevert();
        vault.placeOrder(address(pool), false, 0, 6 * one / 10, 41 * one, 0, 0, 0);
        vm.stopPrank();
    }

    /* ─────────────────────── invariant 3 — NAV bounds ──────────────────────── */

    function test_nav_marksResidualAtZero_soItIsALowerBound() public {
        _deposit(alice, 1_000 * one);

        vm.prank(operator);
        vault.mintSet(address(pool), 100 * one);
        assertEq(vault.nav(), 1_000 * one, "a matched set is carried at par");

        // Sell the YES leg for 0.6 each. Vault: 940 collateral + 100 NO.
        pool.fillAsk(address(vault), YES_ID, 100 * one, 60 * one);

        (uint256 yes, uint256 no) = vault.legTotals();
        uint256 matched = yes < no ? yes : no;
        uint256 idle = usd.balanceOf(address(vault));

        assertEq(matched, 0, "nothing is matched any more");
        assertEq(vault.nav(), idle, "residual NO is marked at zero");
        assertLe(vault.nav(), idle + matched + vault.imbalance(), "upper bound holds");
        assertGe(vault.nav(), idle + matched, "lower bound holds");
    }

    /* ────────────────── invariant 4 — share price monotonic ────────────────── */

    function test_sharePrice_startsAtOne() public {
        _deposit(alice, 500 * one);
        assertEq(vault.sharePrice(), 1e18, "first deposit seeds share price at 1.0");
    }

    function test_sharePrice_neverFallsFromDepositOrWithdrawAlone() public {
        _deposit(alice, 1_000 * one);
        uint256 p0 = vault.sharePrice();

        _deposit(bob, 337 * one);
        uint256 p1 = vault.sharePrice();
        assertGe(p1, p0, "a deposit cannot dilute");

        // Hoist the read: a call inside the argument list consumes the prank,
        // and `withdraw` would then run as the test contract, which holds none.
        uint256 third = vault.balanceOf(bob) / 3;
        vm.prank(bob);
        vault.withdraw(third);
        uint256 p2 = vault.sharePrice();
        assertGe(p2, p1, "a partial withdrawal cannot dilute");
    }

    function testFuzz_depositWithdrawCycle_cannotExtractValue(uint96 a, uint96 b) public {
        uint256 amtA = bound(uint256(a), one / 100 + 1, 10_000 * one);
        uint256 amtB = bound(uint256(b), one / 100 + 1, 10_000 * one);

        _deposit(alice, amtA);
        uint256 before = vault.sharePrice();

        uint256 shares = _deposit(bob, amtB);
        vm.prank(bob);
        vault.withdraw(shares);

        assertGe(vault.sharePrice(), before, "a full in-and-out never leaves the pool worse off");
    }

    /* ───────────────── invariant 5 — operator cannot withdraw ──────────────── */

    function test_operator_cannotMoveCollateralOut() public {
        _deposit(alice, 1_000 * one);

        // There is simply no operator-reachable path that transfers collateral
        // to an arbitrary address. The operator's whole surface is these calls.
        vm.startPrank(operator);
        vm.expectRevert(BallastVault.NotOwner.selector);
        vault.setOperator(operator);

        vm.expectRevert(BallastVault.NotOwner.selector);
        vault.allowPool(address(0xDEAD), 7, 8);

        vm.expectRevert(BallastVault.NotOwner.selector);
        vault.setImbalanceCap(type(uint256).max);
        vm.stopPrank();

        assertEq(usd.balanceOf(address(vault)), 1_000 * one, "collateral never moved");
    }

    function test_operator_cannotTouchAnUnapprovedPool() public {
        _deposit(alice, 1_000 * one);
        MockBinaryPool rogue = new MockBinaryPool(usd, outcome, 99, 100);

        vm.prank(operator);
        vm.expectRevert(BallastVault.PoolNotAllowed.selector);
        vault.mintSet(address(rogue), 1 * one);
    }

    function test_nonOperator_cannotTrade() public {
        _deposit(alice, 1_000 * one);
        vm.prank(alice);
        vm.expectRevert(BallastVault.NotOperator.selector);
        vault.mintSet(address(pool), 1 * one);
    }

    /* ──────────────── invariant 6 — two-sided fill leaves flat ─────────────── */

    /**
     * The proof in ARCHITECTURE.md §2.3, executed.
     *
     * Vault quotes YES bid 0.40 and YES ask 0.60. One taker lifts each side.
     * Selling a NO at 1 − 0.40 = 0.60 is the same trade as buying YES at 0.40.
     * The vault should end flat and up exactly the spread, 0.20 per unit.
     */
    function test_twoSidedFill_endsFlatAndCapturesExactlyTheSpread() public {
        _deposit(alice, 1_000 * one);
        uint256 start = usd.balanceOf(address(vault));
        uint256 size = 10 * one;

        uint256 ask = 6 * one / 10; // 0.60
        uint256 bid = 4 * one / 10; // 0.40

        // Leg 1: taker buys YES at the ask.
        vm.prank(operator);
        vault.mintSet(address(pool), size);
        pool.fillAsk(address(vault), YES_ID, size, (ask * size) / one);

        // Leg 2: taker buys NO at 1 − bid.
        vm.prank(operator);
        vault.mintSet(address(pool), size);
        pool.fillAsk(address(vault), NO_ID, size, ((one - bid) * size) / one);

        // The vault now holds one of each again — flatten it.
        (uint256 yes, uint256 no) = vault.legTotals();
        assertEq(yes, size, "one YES left");
        assertEq(no, size, "one NO left");

        vm.prank(operator);
        vault.burnSet(address(pool), size);

        (yes, no) = vault.legTotals();
        assertEq(yes, 0);
        assertEq(no, 0);
        assertEq(vault.imbalance(), 0, "flat");

        uint256 expected = start + ((ask - bid) * size) / one;
        assertEq(usd.balanceOf(address(vault)), expected, "captured exactly the spread");
    }

    /* ──────────────────────────── housekeeping ─────────────────────────────── */

    function test_pause_blocksDepositsAndOperatorActions() public {
        _deposit(alice, 100 * one);
        vault.setPaused(true);

        vm.prank(alice);
        vm.expectRevert(BallastVault.Paused.selector);
        vault.deposit(1 * one);

        vm.prank(operator);
        vm.expectRevert(BallastVault.Paused.selector);
        vault.mintSet(address(pool), 1 * one);
    }

    function test_withdraw_worksWhilePausedSoDepositorsAreNeverTrapped() public {
        uint256 shares = _deposit(alice, 100 * one);
        vault.setPaused(true);

        vm.prank(alice);
        uint256 out = vault.withdraw(shares);
        assertEq(out, 100 * one, "a paused vault still lets people leave");
    }

    function test_zeroDeposit_reverts() public {
        vm.prank(alice);
        vm.expectRevert(BallastVault.ZeroAmount.selector);
        vault.deposit(0);
    }
}

contract BallastVault6dpTest is VaultTestBase {
    function setUp() public {
        _setUpWithDecimals(6);
    }
}

contract BallastVault18dpTest is VaultTestBase {
    function setUp() public {
        _setUpWithDecimals(18);
    }
}
