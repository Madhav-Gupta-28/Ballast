// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "solmate/tokens/ERC20.sol";
import {IOutcomeToken} from "../../src/interfaces/IOutcomeToken.sol";
import {IBinaryPool} from "../../src/interfaces/IBinaryPool.sol";
import {IBinarySettlement} from "../../src/interfaces/IBinarySettlement.sol";

/// @notice Collateral stand-in. Decimals are constructor-set so tests can run
///         the same assertions at 6dp (testnet tUSDC) and 18dp (mainnet USDso).
contract MockCollateral is ERC20 {
    constructor(uint8 d) ERC20("Mock Collateral", "mUSD", d) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Minimal ERC-6909 singleton: balances keyed by (owner, id).
contract MockOutcomeToken is IOutcomeToken {
    mapping(address => mapping(uint256 => uint256)) internal _bal;
    mapping(address => mapping(address => bool)) internal _op;

    function balanceOf(address owner, uint256 id) external view returns (uint256) {
        return _bal[owner][id];
    }

    function setOperator(address spender, bool approved) external returns (bool) {
        _op[msg.sender][spender] = approved;
        return true;
    }

    function isOperator(address owner, address spender) external view returns (bool) {
        return _op[owner][spender];
    }

    function mintTo(address to, uint256 id, uint256 amount) external {
        _bal[to][id] += amount;
    }

    function burnFrom(address from, uint256 id, uint256 amount) external {
        _bal[from][id] -= amount;
    }
}

/**
 * @notice A binary pool that honours the two rules that matter:
 *         one collateral in  -> one YES + one NO out
 *         one of each in     -> one collateral out
 *
 * Orders are recorded rather than matched; fills are driven explicitly from the
 * tests so each leg of a two-sided fill can be asserted separately.
 */
contract MockBinaryPool {
    MockCollateral public immutable collateral;
    MockOutcomeToken public immutable outcome;
    /// @dev Mutable, like the real thing: a pool rebinds these each window.
    uint256 public yesId;
    uint256 public noId;

    struct Order {
        address maker;
        bool isBid;
        uint256 price;
        uint256 quantity;
        bool live;
    }

    Order[] public orders;

    constructor(MockCollateral _c, MockOutcomeToken _o, uint256 _yesId, uint256 _noId) {
        collateral = _c;
        outcome = _o;
        yesId = _yesId;
        noId = _noId;
    }

    /// @dev Mirrors the live pool: ids are served from here, never cached by
    ///      callers. `nonce` moves so a test can simulate a window recycle.
    uint64 public nonce = 1;

    function getBinaryPoolParams() external view returns (IBinaryPool.BinaryPoolParams memory p) {
        p.collateralToken = address(collateral);
        p.outcomeToken = address(outcome);
        p.yesId = yesId;
        p.noId = noId;
        p.oneCollateral = 10 ** collateral.decimals();
        p.marketNonce = nonce;
    }

    /// @notice Roll the pool onto a new window, exactly as v2 does: bump the
    ///         nonce and rebind to a fresh pair of outcome ids.
    function recycle() external {
        nonce += 1;
        yesId += 2;
        noId += 2;
    }

    function mintSet(address yesTo, address noTo, uint256 amount) external {
        collateral.transferFrom(msg.sender, address(this), amount);
        outcome.mintTo(yesTo, yesId, amount);
        outcome.mintTo(noTo, noId, amount);
    }

    function burnSet(uint256 amount) external {
        outcome.burnFrom(msg.sender, yesId, amount);
        outcome.burnFrom(msg.sender, noId, amount);
        collateral.transfer(msg.sender, amount);
    }

    /**
     * Faithful to the venue: kinds are 0 BUY_YES, 1 SELL_YES, 2 BUY_NO,
     * 3 SELL_NO. A buy escrows collateral (the pool pulls it), a sell escrows
     * outcome tokens. The generic placeOrder does not exist on a binary pool —
     * it reverts there with UseBinaryPlacement().
     */
    function placeBinaryOrder(
        uint8 kind,
        uint256 price,
        uint256 quantity,
        uint64,
        uint8,
        uint8,
        address,
        uint96,
        uint64
    ) external returns (uint256 orderId) {
        require(kind <= 3, "bad kind");
        bool isBuy = kind == 0 || kind == 2;
        if (isBuy) {
            uint256 need = (price * quantity) / (10 ** collateral.decimals());
            require(need > 0, "buy escrow rounds to zero");
            collateral.transferFrom(msg.sender, address(this), need);
        } else {
            uint256 id = kind == 1 ? yesId : noId;
            outcome.burnFrom(msg.sender, id, quantity);
        }
        orders.push(Order({maker: msg.sender, isBid: isBuy, price: price, quantity: quantity, live: true}));
        return orders.length - 1;
    }

    function cancelOrder(uint128 orderId) external {
        orders[orderId].live = false;
    }

    function cancelOrders(uint128[] calldata ids) external {
        for (uint256 i; i < ids.length; ++i) {
            orders[ids[i]].live = false;
        }
    }

    /// @notice Simulate a taker lifting the vault's ask on one leg.
    ///         The vault delivers `id` and receives `price * qty` collateral.
    function fillAsk(address maker, uint256 id, uint256 qty, uint256 proceeds) external {
        outcome.burnFrom(maker, id, qty);
        collateral.transfer(maker, proceeds);
    }

    function seed(uint256 amount) external {
        collateral.mint(address(this), amount);
    }

    function orderCount() external view returns (uint256) {
        return orders.length;
    }
}

/**
 * @notice Settlement stand-in. A winning outcome redeems 1:1 (the live venue's
 *         settlement fee is currently zero); a losing one pays nothing.
 */
contract MockSettlement is IBinarySettlement {
    MockCollateral public immutable collateral;
    MockOutcomeToken public immutable outcome;
    mapping(uint256 => bool) public winner;

    constructor(MockCollateral _c, MockOutcomeToken _o) {
        collateral = _c;
        outcome = _o;
    }

    function setWinner(uint256 outcomeId, bool won) external {
        winner[outcomeId] = won;
    }

    function redeem(uint256 outcomeId, uint256 amount, address to) public returns (uint256 collateralOut) {
        outcome.burnFrom(msg.sender, outcomeId, amount);
        collateralOut = winner[outcomeId] ? amount : 0;
        if (collateralOut > 0) collateral.transfer(to, collateralOut);
    }

    function finalizeAndRedeem(address, uint256 outcomeId, uint256 amount, address to)
        external
        returns (uint256)
    {
        return redeem(outcomeId, amount, to);
    }

    function seed(uint256 amount) external {
        collateral.mint(address(this), amount);
    }
}

/// @notice A pool that reverts on the params read. Models a pool that gets
///         paused, upgraded to something incompatible, or simply goes away.
contract RevertingPool {
    function getBinaryPoolParams() external pure returns (IBinaryPool.BinaryPoolParams memory) {
        revert("pool is gone");
    }
}

/// @notice A pool that burns all available gas on the params read.
contract GasBombPool {
    function getBinaryPoolParams() external view returns (IBinaryPool.BinaryPoolParams memory p) {
        uint256 i;
        while (gasleft() > 5000) i++;
        p.yesId = i;
    }
}
