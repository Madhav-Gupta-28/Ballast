// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "solmate/tokens/ERC20.sol";
import {SafeTransferLib} from "solmate/utils/SafeTransferLib.sol";
import {ReentrancyGuard} from "solmate/utils/ReentrancyGuard.sol";
import {IBinaryPool} from "./interfaces/IBinaryPool.sol";
import {IOutcomeToken} from "./interfaces/IOutcomeToken.sol";
import {IBinarySettlement} from "./interfaces/IBinarySettlement.sol";

/**
 * @title  BallastVault
 * @notice A pooled counterparty for DreamDEX event contracts.
 *
 * Depositors put collateral in and receive shares. An operator key quotes both
 * sides of every live BTC/ETH window on the vault's behalf. The vault itself is
 * the trading account: it mints complete sets, holds the outcome tokens, and
 * places the orders. The operator never custodies anything.
 *
 * ## Why holding matched legs is riskless
 *
 * On DreamDEX one unit of collateral mints one YES and one NO, and that pair
 * pays exactly one unit at every resolution:
 *
 *   YES wins -> 1 + 0   = 1
 *   NO  wins -> 0 + 1   = 1
 *   voided   -> 0.5+0.5 = 1
 *
 * So a matched book carries no price risk. The vault's whole exposure is the
 * IMBALANCE between its two legs, and that is what `imbalanceCap` bounds. The
 * cap lives here, on-chain, precisely so a buggy or stolen operator key cannot
 * exceed it — see ARCHITECTURE.md §9.
 *
 * ## What the operator may and may not do
 *
 *   may:     mintSet, burnSet, placeOrder, cancelOrder on ALLOWLISTED pools
 *   may not: move collateral to any address, add a pool, change the cap,
 *            mint or burn shares
 *
 * Pools are allowlisted by the owner. DreamDEX recycles a pool's (nonce -> ids)
 * binding across successive windows, so the set of live pool addresses is small
 * and stable rather than one-per-market.
 */
contract BallastVault is ERC20, ReentrancyGuard {
    using SafeTransferLib for ERC20;

    /* ─────────────────────────────── immutables ────────────────────────────── */

    /// @notice USDso on mainnet (18dp), tUSDC on testnet (6dp).
    ERC20 public immutable collateral;

    /// @notice The ERC-6909 singleton every outcome token lives on.
    IOutcomeToken public immutable outcomeToken;

    /// @notice The redemption singleton settled positions are cashed through.
    IBinarySettlement public immutable settlement;

    /// @dev Scales collateral units up to the 18dp share basis. 1 on mainnet,
    ///      1e12 on testnet. Shares are always 18dp so the front end never has
    ///      to branch on network — ARCHITECTURE.md §6.3.
    uint256 public immutable scale;

    /// @dev One whole unit of collateral: 1e18 on mainnet, 1e6 on testnet.
    ///      Prices and sizes both carry this scale, so a price*size product
    ///      carries it twice and has to be divided back down by exactly this.
    ///      Hardcoding 1e18 here silently yields ZERO on the 6dp venue.
    uint256 public immutable one;

    /* ──────────────────────────────── storage ──────────────────────────────── */

    address public owner;
    address public operator;
    bool public paused;

    /**
     * @notice Ceiling on the accounting list length.
     *
     * @dev Not arbitrary: `legTotals` costs two external calls per pool and sits
     *      under every deposit, withdrawal and operator action. At 64 pools a
     *      deposit is a few hundred thousand gas; unbounded, it eventually
     *      exceeds any sane limit. The venue keeps only a handful of series
     *      live at once, so this is far above what operation needs.
     */
    uint256 public constant MAX_POOLS = 64;

    /// @dev The venue's four order kinds. Only the buys are named because only
    ///      they need collateral escrowed — a sell is covered by the outcome
    ///      tokens the vault already holds.
    ///      0 BUY_YES · 1 SELL_YES · 2 BUY_NO · 3 SELL_NO
    uint8 internal constant BUY_YES = 0;
    uint8 internal constant BUY_NO = 2;

    /// @dev Gas ceilings on the per-pool reads in `legTotals`. Generous for a
    ///      view returning a static struct, and low enough that 64 uncooperative
    ///      pools still cannot exhaust a block.
    uint256 private constant POOL_READ_GAS = 150_000;
    uint256 private constant TOKEN_READ_GAS = 100_000;

    /// @notice Hard bound on |YES - NO| across all tracked positions, raw units.
    uint256 public imbalanceCap;

    /// @notice Pools the operator is allowed to touch.
    mapping(address => bool) public poolAllowed;

    /// @dev Pools ever allowlisted, for iteration. Outcome ids are NOT stored —
    ///      see `legTotals`.
    address[] public pools;
    mapping(address => bool) internal known;

    /* ───────────────────────────────── events ──────────────────────────────── */

    event Deposit(address indexed who, uint256 amount, uint256 shares);
    event Withdraw(address indexed who, uint256 shares, uint256 amount);
    event OperatorSet(address indexed operator);
    event PoolAllowed(address indexed pool);
    event PoolRevoked(address indexed pool);
    event PoolPurged(address indexed pool);
    event ImbalanceCapSet(uint256 cap);
    event PausedSet(bool paused);
    event Redeemed(uint256 indexed outcomeId, uint256 amount, uint256 collateralOut);

    /* ───────────────────────────────── errors ──────────────────────────────── */

    error NotOwner();
    error NotOperator();
    error Paused();
    error PoolNotAllowed();
    error ZeroAmount();
    error NothingToRedeem();
    error BadOrderKind();
    error PoolNotEmpty();
    error TooManyPools();
    error ZeroAddress();
    error ImbalanceCapExceeded(uint256 imbalance, uint256 cap);

    /* ─────────────────────────────── modifiers ─────────────────────────────── */

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        if (paused) revert Paused();
        _;
    }

    /// @dev Backstop. Minting or burning a complete set moves both legs by the
    ///      same amount and so cannot change the imbalance — that is the whole
    ///      point of §2.1 — which means this modifier almost never binds. The
    ///      guard that does the real work is the forward-looking check in
    ///      `placeOrder`. This stays as defence in depth against a pool that
    ///      does not behave the way the ABI says it does.
    modifier boundedImbalance() {
        _;
        uint256 imb = imbalance();
        if (imb > imbalanceCap) revert ImbalanceCapExceeded(imb, imbalanceCap);
    }

    /* ──────────────────────────────── ctor ─────────────────────────────────── */

    constructor(
        ERC20 _collateral,
        IOutcomeToken _outcomeToken,
        IBinarySettlement _settlement,
        uint256 _imbalanceCap
    ) ERC20("Ballast Vault Share", "BALLAST", 18) {
        collateral = _collateral;
        outcomeToken = _outcomeToken;
        settlement = _settlement;
        owner = msg.sender;
        imbalanceCap = _imbalanceCap;

        uint8 d = _collateral.decimals();
        require(d <= 18, "collateral decimals > 18");
        scale = 10 ** (18 - d);
        one = 10 ** d;

        emit ImbalanceCapSet(_imbalanceCap);
    }

    /* ─────────────────────────────── accounting ────────────────────────────── */

    /**
     * @notice Net asset value in raw collateral units.
     *
     * NAV = idle collateral + matched sets. Nothing else.
     *
     * A matched pair is worth exactly one collateral whatever happens, so it is
     * carried at par. The residual imbalance is carried at ZERO — the most
     * conservative mark available, since an outcome token is worth somewhere in
     * [0, 1] and we refuse to guess which.
     *
     * This makes NAV a strict lower bound on liquidation value, which is the
     * property a withdrawing depositor actually needs. It also means share
     * price ticks UP when a residual resolves in the vault's favour, and never
     * down from an optimistic mark that failed to materialise.
     */
    function nav() public view returns (uint256) {
        (uint256 yes, uint256 no) = legTotals();
        uint256 matched = yes < no ? yes : no;
        return collateral.balanceOf(address(this)) + matched;
    }

    /// @notice Collateral per share, 18dp. Returns 1e18 for an empty vault.
    function sharePrice() public view returns (uint256) {
        uint256 supply = totalSupply;
        if (supply == 0) return 1e18;
        return (nav() * scale * 1e18) / supply;
    }

    /**
     * @notice Total YES and NO held across every allowlisted pool, raw units.
     *
     * @dev The outcome ids are read from each pool on every call rather than
     *      stored. A pool rebinds its (nonce -> ids) pair for each new window —
     *      one live testnet pool was already on its 98th — so any id captured at
     *      allowlist time is stale within minutes. A vault reading stale ids
     *      sees zero balances, reports an imbalance of zero, and its cap stops
     *      binding exactly when it is needed. Reading live costs one call per
     *      pool and cannot go wrong.
     */
    function legTotals() public view returns (uint256 yes, uint256 no) {
        uint256 n = pools.length;
        for (uint256 i; i < n; ++i) {
            address pool = pools[i];

            // Every read below is a capped staticcall that is allowed to fail.
            //
            // This is not defensive noise. `legTotals` sits under nav(),
            // sharePrice(), deposit(), withdraw() and every operator action, so
            // a plain external call here puts the whole vault — including the
            // exit — downstream of an address the owner allowlisted once. A
            // pool that is paused, upgraded, self-destructed or simply
            // mistyped would otherwise revert this loop and lock depositors
            // out of their own money permanently.
            //
            // A pool that will not answer is counted as zero. That
            // under-states NAV, which is the same direction every other
            // approximation here errs in, and is vastly better than bricking.
            (bool ok, bytes memory raw) =
                pool.staticcall{gas: POOL_READ_GAS}(abi.encodeWithSelector(IBinaryPool.getBinaryPoolParams.selector));
            if (!ok || raw.length < 480) continue;

            IBinaryPool.BinaryPoolParams memory p = abi.decode(raw, (IBinaryPool.BinaryPoolParams));
            yes += _balance(p.yesId);
            no += _balance(p.noId);
        }
    }

    /// @dev Capped, failure-tolerant read of one outcome leg. Same reasoning as
    ///      `legTotals`: the singleton must not be able to brick the vault.
    function _balance(uint256 id) internal view returns (uint256) {
        (bool ok, bytes memory raw) = address(outcomeToken).staticcall{gas: TOKEN_READ_GAS}(
            abi.encodeWithSelector(IOutcomeToken.balanceOf.selector, address(this), id)
        );
        if (!ok || raw.length < 32) return 0;
        return abi.decode(raw, (uint256));
    }

    /**
     * @notice |YES - NO| across all pools. The only number that carries risk.
     *
     * @dev Reads WALLET balances, so outcome tokens sitting in escrow behind a
     *      resting sell order are not counted. A vault that is economically
     *      flat but has one leg escrowed therefore reports a small imbalance
     *      it does not really have.
     *
     *      That is the safe direction to be wrong in — the cap binds slightly
     *      early rather than slightly late — so it is left as is. Netting
     *      escrow back in would mean tracking every open order on-chain, which
     *      is a much larger surface for a much smaller gain.
     */
    function imbalance() public view returns (uint256) {
        (uint256 yes, uint256 no) = legTotals();
        return yes > no ? yes - no : no - yes;
    }

    /* ────────────────────────────── depositors ─────────────────────────────── */

    /**
     * @notice Deposit collateral, receive shares.
     * @dev Shares round DOWN, so rounding dust always accrues to the pool and
     *      never to the depositor. This is what makes share price monotonic.
     */
    function deposit(uint256 amount) external nonReentrant returns (uint256 sharesOut) {
        if (paused) revert Paused();
        if (amount == 0) revert ZeroAmount();

        uint256 supply = totalSupply;
        uint256 navBefore = nav();

        sharesOut = supply == 0 ? amount * scale : (amount * supply) / navBefore;
        if (sharesOut == 0) revert ZeroAmount();

        collateral.safeTransferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, sharesOut);

        emit Deposit(msg.sender, amount, sharesOut);
    }

    /**
     * @notice Burn shares, receive collateral.
     * @dev Pays only from idle collateral. A withdrawal larger than the idle
     *      balance reverts rather than force-unwinding live quotes — the
     *      operator flattens first, then the withdrawal succeeds. Depositors
     *      are never silently paid out of a position that has not been closed.
     *
     *      Deliberately not gated on `paused`. Pausing stops new money going in
     *      and stops the operator trading; it must never trap money already in.
     *      Asserted by `test_withdraw_worksWhilePausedSoDepositorsAreNeverTrapped`.
     */
    function withdraw(uint256 shares) external nonReentrant returns (uint256 amountOut) {
        if (shares == 0) revert ZeroAmount();

        uint256 supply = totalSupply;
        amountOut = (shares * nav()) / supply;
        if (amountOut == 0) revert ZeroAmount();

        _burn(msg.sender, shares);
        collateral.safeTransfer(msg.sender, amountOut);

        emit Withdraw(msg.sender, shares, amountOut);
    }

    /* ─────────────────────────────── operator ──────────────────────────────── */

    /// @notice Mint `amount` complete sets; both legs land in the vault.
    function mintSet(address pool, uint256 amount) external onlyOperator boundedImbalance {
        if (!poolAllowed[pool]) revert PoolNotAllowed();
        if (amount == 0) revert ZeroAmount();

        collateral.safeApprove(pool, 0);
        collateral.safeApprove(pool, amount);
        IBinaryPool(pool).mintSet(address(this), address(this), amount);
        collateral.safeApprove(pool, 0);
    }

    /// @notice Burn `amount` matched pairs back into collateral.
    function burnSet(address pool, uint256 amount) external onlyOperator boundedImbalance {
        if (!poolAllowed[pool]) revert PoolNotAllowed();
        if (amount == 0) revert ZeroAmount();
        IBinaryPool(pool).burnSet(amount);
    }

    /**
     * @notice Place a limit order on an allowlisted pool.
     *
     * @param kind 0 BUY_YES · 1 SELL_YES · 2 BUY_NO · 3 SELL_NO
     * @param price     raw units, already a whole multiple of the venue's tick
     * @param quantity  raw units, already a whole multiple of the venue's lot
     *
     * @dev A buy escrows collateral, which the pool pulls, so it needs an
     *      allowance. A sell escrows outcome tokens, already covered by the
     *      one-time operator approval `allowPool` sets on the ERC-6909
     *      singleton — there is no naked short, the vault must hold them.
     */
    function placeBinaryOrder(
        address pool,
        uint8 kind,
        uint256 price,
        uint256 quantity,
        uint64 expireTimestampNs,
        uint8 orderType,
        uint8 selfMatchingOption
    ) external onlyOperator boundedImbalance returns (uint256 orderId) {
        if (!poolAllowed[pool]) revert PoolNotAllowed();
        if (kind > 3) revert BadOrderKind();

        // Forward-looking cap check. An imbalance is created by a FILL, and a
        // fill does not call this contract — a taker lifts a resting order and
        // the vault's legs move without any vault function running. So the only
        // place the cap can bind is here, before the order exists.
        uint256 worstCase = imbalance() + quantity;
        if (worstCase > imbalanceCap) revert ImbalanceCapExceeded(worstCase, imbalanceCap);

        bool isBuy = kind == BUY_YES || kind == BUY_NO;
        if (isBuy) {
            // Both operands carry the collateral scale, so the product carries
            // it twice and comes back down by `one` — never a literal 1e18,
            // which truncates to zero on the 6dp venue.
            uint256 need = (price * quantity) / one;
            collateral.safeApprove(pool, 0);
            collateral.safeApprove(pool, need);
        }

        orderId = IBinaryPool(pool).placeBinaryOrder(
            kind,
            price,
            quantity,
            expireTimestampNs,
            orderType,
            selfMatchingOption,
            address(0), // no builder
            0, // no builder fee
            0 // userData: opaque, unused
        );

        if (isBuy) collateral.safeApprove(pool, 0);
    }

    function cancelOrder(address pool, uint128 orderId) external onlyOperator {
        if (!poolAllowed[pool]) revert PoolNotAllowed();
        IBinaryPool(pool).cancelOrder(orderId);
    }

    function cancelOrders(address pool, uint128[] calldata orderIds) external onlyOperator {
        if (!poolAllowed[pool]) revert PoolNotAllowed();
        IBinaryPool(pool).cancelOrders(orderIds);
    }

    /* ─────────────────────────────── settlement ───────────────────────────────── */

    /**
     * @notice Cash a settled position back into collateral.
     *
     * @dev Winnings are claimed, not received. A settled position sits there
     *      until someone asks for it, and it is invisible to `legTotals` the
     *      moment its pool rebinds to the next window — so an unredeemed
     *      position is value the vault holds but does not count. Without this
     *      the vault could trade indefinitely and watch its NAV drift down.
     *
     *      Anyone may call it. There is no discretion here: it burns a settled
     *      outcome the vault already owns and sends the proceeds to the vault.
     *      Leaving it permissionless means a stuck operator cannot strand
     *      depositors' money.
     */
    function redeem(uint256 outcomeId, uint256 amount) external nonReentrant returns (uint256 collateralOut) {
        if (amount == 0) revert ZeroAmount();
        collateralOut = settlement.redeem(outcomeId, amount, address(this));
        // A redemption that pays nothing is either an unresolved market or a
        // losing leg. Burning either accomplishes nothing and, since this is
        // permissionless, would let a passer-by destroy live inventory for
        // free. Refuse it.
        if (collateralOut == 0) revert NothingToRedeem();
        emit Redeemed(outcomeId, amount, collateralOut);
    }

    /// @notice As `redeem`, for a market nobody has finalized yet.
    function finalizeAndRedeem(address pool, uint256 outcomeId, uint256 amount)
        external
        nonReentrant
        returns (uint256 collateralOut)
    {
        if (amount == 0) revert ZeroAmount();
        collateralOut = settlement.finalizeAndRedeem(pool, outcomeId, amount, address(this));
        if (collateralOut == 0) revert NothingToRedeem();
        emit Redeemed(outcomeId, amount, collateralOut);
    }

    /* ──────────────────────────────── owner ────────────────────────────────── */

    function setOperator(address _operator) external onlyOwner {
        operator = _operator;
        emit OperatorSet(_operator);
    }

    /**
     * @notice Allow the operator to trade a pool.
     * @dev No ids are taken: `legTotals` reads them from the pool each time, so
     *      the vault cannot be pointed at the wrong leg by mistake or on purpose.
     */
    function allowPool(address pool) external onlyOwner {
        if (!known[pool]) {
            if (pools.length >= MAX_POOLS) revert TooManyPools();
            pools.push(pool);
            known[pool] = true;
        }
        poolAllowed[pool] = true;

        // Both legs are covered by one operator approval on the singleton.
        outcomeToken.setOperator(pool, true);

        emit PoolAllowed(pool);
    }

    /**
     * @notice Stop the operator trading a pool. Positions already held there
     *         still count toward NAV — use `purgePool` to drop it entirely.
     */
    function revokePool(address pool) external onlyOwner {
        poolAllowed[pool] = false;
        outcomeToken.setOperator(pool, false);
        emit PoolRevoked(pool);
    }

    /**
     * @notice Remove a pool from the accounting list entirely.
     *
     * @dev `legTotals` walks this array and makes two external calls per entry,
     *      and every deposit, withdrawal and operator action pays for that. The
     *      venue opens new pools continuously, so without a way to drop dead
     *      ones the list grows without bound and the vault slowly prices itself
     *      out of use.
     *
     *      Only removable once the vault holds nothing there, so purging can
     *      never erase live value — the check is the whole safety property.
     *
     *      Which is also its limit: a pool that stops answering cannot be
     *      purged, because emptiness can no longer be proven. `legTotals`
     *      tolerates such a pool by counting it as zero, so the vault keeps
     *      working and the entry is merely permanent. Forcing the removal would
     *      mean trusting the owner not to erase live value, which is the bug
     *      this check exists to prevent.
     */
    function purgePool(address pool) external onlyOwner {
        IBinaryPool.BinaryPoolParams memory p = IBinaryPool(pool).getBinaryPoolParams();
        if (
            outcomeToken.balanceOf(address(this), p.yesId) != 0
                || outcomeToken.balanceOf(address(this), p.noId) != 0
        ) revert PoolNotEmpty();

        uint256 n = pools.length;
        for (uint256 i; i < n; ++i) {
            if (pools[i] != pool) continue;
            pools[i] = pools[n - 1];
            pools.pop();
            break;
        }
        poolAllowed[pool] = false;
        known[pool] = false;
        outcomeToken.setOperator(pool, false);
        emit PoolPurged(pool);
    }

    function setImbalanceCap(uint256 cap) external onlyOwner {
        imbalanceCap = cap;
        emit ImbalanceCapSet(cap);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    /// @dev Rejects the zero address: handing ownership to nobody would leave
    ///      the cap, the allowlist and the pause permanently unreachable.
    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        owner = next;
    }

    /// @notice Number of pools ever allowlisted (including revoked ones).
    function poolCount() external view returns (uint256) {
        return pools.length;
    }
}
