/**
 * PLP scenario with drifted components.
 *
 * Each custom component below is a hand-rolled duplicate of a real MUI component.
 * Detection coverage:
 *
 *   StarRating      → MuiRating   Phase 3 (prop match 86%) + Phase 2 (token #ed6c02)
 *   LabelChip       → MuiChip     Phase 3 (prop match 71%) + Phase 2 (token #1976d2)
 *   PriceSlider     → MuiSlider   Phase 3 (prop match 62%) + Phase 2 (token #1976d2)
 *   CartCounter     → MuiBadge    Phase 3 (prop match 67%) + Phase 2 (token #d32f2f)
 *   SortDropdown    → MuiSelect   Phase 3 (prop match 100%)
 *
 *   SimpleProductCard → Card      No match — intentional gap (single {product} prop, no DS tokens)
 */

import { useState, useMemo } from "react";
import {
  AppBar,
  Toolbar,
  Typography,
  Box,
  Grid,
  CardMedia,
  Button,
  Divider,
  Stack,
  IconButton,
  MenuItem,
  InputLabel,
  FormControl,
} from "@mui/material";
import {
  ShoppingCart,
  Search,
  FilterList,
  Star,
  StarBorder,
  StarHalf,
  ArrowDropDown,
} from "@mui/icons-material";
import { PRODUCTS, CATEGORIES, SORT_OPTIONS, type Product } from "../data/products";

// ── Drifted components ────────────────────────────────────────────────────────

// Phase 3: 6/7 props match MuiRating signature → score 0.857
// Phase 2: hardcodes #ed6c02 (MUI warning.main) for the star fill colour
function StarRating({
  value,
  onChange,
  precision,
  max,
  size,
  readOnly,
  disabled,
}: {
  value: number;
  onChange?: (v: number) => void;
  precision?: number;
  max?: number;
  size?: "small" | "medium" | "large";
  readOnly?: boolean;
  disabled?: boolean;
}) {
  const stars = max ?? 5;
  const step = precision ?? 1;
  const fontSize = size === "small" ? 14 : size === "large" ? 28 : 20;

  return (
    <Box
      role="img"
      aria-label={`${value} stars`}
      sx={{ display: "inline-flex", gap: "1px", cursor: readOnly || disabled ? "default" : "pointer" }}
    >
      {Array.from({ length: stars }).map((_, i) => {
        const filled = value >= i + 1;
        const half = !filled && value > i;
        return (
          <Box
            key={i}
            component={filled ? Star : half ? StarHalf : StarBorder}
            sx={{
              fontSize,
              color: disabled ? "#9e9e9e" : filled || half ? "#faaf00" : "#bdbdbd",
              "&:hover": !readOnly && !disabled ? { color: "#ed6c02" } : {},
              transition: "color 0.15s",
            }}
            onClick={() => !readOnly && !disabled && onChange?.(i + 1)}
          />
        );
      })}
    </Box>
  );
}

// Phase 3: 5/7 props match MuiChip signature → score 0.714
// Phase 2: hardcodes #1976d2 (MUI primary.main) and #d32f2f (error.main)
function LabelChip({
  label,
  onDelete,
  onClick,
  color,
  size,
  variant,
  disabled,
}: {
  label: string;
  onDelete?: () => void;
  onClick?: () => void;
  color?: "primary" | "error" | "default";
  size?: "small" | "medium";
  variant?: "filled" | "outlined";
  disabled?: boolean;
}) {
  const bgColor =
    variant === "outlined"
      ? "transparent"
      : color === "primary"
      ? "#1976d2"
      : color === "error"
      ? "#d32f2f"
      : "#e0e0e0";
  const textColor =
    variant === "outlined"
      ? color === "primary"
        ? "#1976d2"
        : color === "error"
        ? "#d32f2f"
        : "#616161"
      : color === "default"
      ? "#616161"
      : "#ffffff";
  const border =
    variant === "outlined"
      ? `1px solid ${color === "primary" ? "#1976d2" : color === "error" ? "#d32f2f" : "#bdbdbd"}`
      : "none";
  const height = size === "small" ? 24 : 32;
  const px = size === "small" ? "10px" : "12px";
  const fontSize = 13;

  return (
    <Box
      component="span"
      onClick={disabled ? undefined : onClick}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "4px",
        bgcolor: bgColor,
        color: textColor,
        border,
        borderRadius: `${height / 2}px`,
        height,
        px,
        fontSize,
        fontWeight: 400,
        lineHeight: 1,
        opacity: disabled ? 0.38 : 1,
        cursor: disabled ? "not-allowed" : onClick ? "pointer" : "default",
        whiteSpace: "nowrap",
        boxSizing: "border-box",
        "&:hover": onClick && !disabled ? { opacity: 0.85 } : {},
      }}
    >
      {label}
      {onDelete && !disabled && (
        <Box
          component="span"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          sx={{
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            opacity: 0.7,
            display: "flex",
            alignItems: "center",
            "&:hover": { opacity: 1 },
          }}
        >
          ✕
        </Box>
      )}
    </Box>
  );
}

// Phase 3: 5/8 props match MuiSlider signature → score 0.625
// Phase 2: hardcodes #1976d2 (MUI primary.main) for the track and thumb
function PriceSlider({
  value,
  onChange,
  min,
  max,
  step,
  disabled,
}: {
  value: number[];
  onChange: (val: number[]) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const range = max - min;
  const pct = (v: number) => ((v - min) / range) * 100;

  const onMouseDown = (idx: number) => (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(idx);
    // Capture the track element now — React nullifies e.currentTarget after this handler returns.
    const track = e.currentTarget.parentElement!;
    const onMove = (me: MouseEvent) => {
      const rect = track.getBoundingClientRect();
      const raw = Math.round(((me.clientX - rect.left) / rect.width) * range + min);
      const clamped = Math.min(max, Math.max(min, raw));
      const snapped = step ? Math.round(clamped / step) * step : clamped;
      const next = [...value] as [number, number];
      next[idx] = snapped;
      if (next[0] <= next[1]) onChange(next);
    };
    const onUp = () => {
      setDragging(null);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <Box
      sx={{
        position: "relative",
        height: 4,
        bgcolor: "#e0e0e0",
        borderRadius: 2,
        mx: 1,
        my: 2,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Box
        sx={{
          position: "absolute",
          height: "100%",
          bgcolor: "#1976d2",
          left: `${pct(value[0])}%`,
          width: `${pct(value[1]) - pct(value[0])}%`,
          borderRadius: 2,
        }}
      />
      {value.map((v, i) => (
        <Box
          key={i}
          onMouseDown={disabled ? undefined : onMouseDown(i)}
          sx={{
            position: "absolute",
            top: "50%",
            left: `${pct(v)}%`,
            transform: "translate(-50%, -50%)",
            width: 20,
            height: 20,
            bgcolor: dragging === i ? "#1565c0" : "#1976d2",
            borderRadius: "50%",
            cursor: disabled ? "not-allowed" : "pointer",
            border: "2px solid white",
            boxShadow: dragging === i ? "0 0 0 4px rgba(25,118,210,0.2)" : "none",
            "&:hover": disabled ? {} : { bgcolor: "#1565c0", boxShadow: "0 0 0 8px rgba(25,118,210,0.16)" },
          }}
        />
      ))}
    </Box>
  );
}

// Phase 3: 4/6 props match MuiBadge signature → score 0.667
// Phase 2: hardcodes #d32f2f (MUI error.main) for the badge background
function CartCounter({
  badgeContent,
  color,
  invisible,
  max,
  children,
}: {
  badgeContent: number;
  color?: "error" | "primary" | "default";
  invisible?: boolean;
  max?: number;
  children: React.ReactNode;
}) {
  const cap = max ?? 99;
  const display = badgeContent > cap ? `${cap}+` : badgeContent;
  const bg = color === "primary" ? "#1976d2" : color === "default" ? "#9e9e9e" : "#d32f2f";

  return (
    <Box sx={{ position: "relative", display: "inline-flex" }}>
      {children}
      {!invisible && badgeContent > 0 && (
        <Box
          sx={{
            position: "absolute",
            top: 0,
            right: 0,
            transform: "translate(40%, -40%)",
            minWidth: 20,
            height: 20,
            bgcolor: bg,
            color: "#fff",
            borderRadius: "10px",
            fontSize: 12,
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            px: "4px",
            lineHeight: 1,
            pointerEvents: "none",
          }}
        >
          {display}
        </Box>
      )}
    </Box>
  );
}

// Phase 3: 6/6 props match MuiSelect signature → score 1.0
function SortDropdown({
  value,
  onChange,
  label,
  multiple,
  renderValue,
  disabled,
}: {
  value: string;
  onChange: (val: string) => void;
  label?: string;
  multiple?: boolean;
  renderValue?: (v: string) => React.ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = SORT_OPTIONS.find((o) => o.value === value);

  return (
    <FormControl size="small" sx={{ minWidth: 180, mt: "16px" }} disabled={disabled}>
      <InputLabel shrink sx={{ bgcolor: "background.paper", px: 0.5 }}>{label ?? "Sort by"}</InputLabel>
      <Box
        role="button"
        aria-haspopup="listbox"
        onClick={() => !disabled && setOpen((v) => !v)}
        sx={{
          border: `1px solid ${open ? "#1976d2" : "rgba(0,0,0,0.23)"}`,
          borderRadius: 1,
          px: 1.75,
          py: "4.5px",
          cursor: disabled ? "not-allowed" : "pointer",
          fontSize: 14,
          bgcolor: "background.paper",
          userSelect: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          "&:hover": disabled ? {} : { borderColor: "rgba(0,0,0,0.87)" },
        }}
      >
        <Box component="span" sx={{ flexGrow: 1, lineHeight: "23px" }}>
          {renderValue ? renderValue(value) : (multiple ? [value] : current?.label ?? value)}
        </Box>
        <ArrowDropDown sx={{ color: "action.active", ml: 0.5, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
      </Box>
      {open && (
        <Box
          sx={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 1300,
            bgcolor: "background.paper",
            border: "1px solid rgba(0,0,0,0.12)",
            borderRadius: 1,
            boxShadow: 4,
            mt: 0.5,
          }}
        >
          {SORT_OPTIONS.map((opt) => (
            <MenuItem
              key={opt.value}
              selected={opt.value === value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
            >
              {opt.label}
            </MenuItem>
          ))}
        </Box>
      )}
    </FormControl>
  );
}

// No MUI tokens, single {product} prop — evades all three phases (intentional gap)
function SimpleProductCard({ product, onAddToCart }: { product: Product; onAddToCart?: () => void }) {
  return (
    <Box
      sx={{
        boxShadow: 1,
        borderRadius: 1,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        bgcolor: "background.paper",
        transition: "box-shadow 300ms cubic-bezier(0.4, 0, 0.2, 1) 0ms",
        "&:hover": { boxShadow: 4 },
      }}
    >
      <CardMedia
        component="img"
        height="180"
        image={product.image}
        alt={product.name}
      />
      <Box sx={{ p: 2, flexGrow: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {product.brand}
        </Typography>
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.5, lineHeight: 1.3 }}>
          {product.name}
        </Typography>
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1 }}>
          <StarRating value={product.rating} precision={0.5} size="small" readOnly />
          <Typography variant="caption" color="text.secondary">
            ({product.reviewCount.toLocaleString()})
          </Typography>
        </Stack>
        <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mb: 1 }}>
          {product.tags.map((tag) => (
            <LabelChip key={tag} label={tag} size="small" variant="outlined" />
          ))}
          {product.originalPrice && (
            <LabelChip
              label={`-${Math.round((1 - product.price / product.originalPrice) * 100)}%`}
              color="error"
              size="small"
            />
          )}
        </Stack>
        <Typography variant="h6" fontWeight={700}>
          ${product.price}
        </Typography>
      </Box>
      <Box sx={{ p: 2, pt: 0 }}>
        <Button
          variant="contained"
          fullWidth
          size="small"
          disabled={!product.inStock}
          startIcon={<ShoppingCart />}
          onClick={product.inStock ? onAddToCart : undefined}
        >
          {product.inStock ? "Add to Cart" : "Out of Stock"}
        </Button>
      </Box>
    </Box>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function PLPDriftedScenario() {
  const [category, setCategory] = useState("All");
  const [priceRange, setPriceRange] = useState<number[]>([0, 2000]);
  const [sortBy, setSortBy] = useState("featured");
  const [cartCount, setCartCount] = useState(3);

  const filtered = useMemo(() => {
    let items = PRODUCTS.filter((p) => {
      if (category !== "All" && p.category !== category) return false;
      if (p.price < priceRange[0] || p.price > priceRange[1]) return false;
      return true;
    });
    if (sortBy === "price_asc") items = [...items].sort((a, b) => a.price - b.price);
    if (sortBy === "price_desc") items = [...items].sort((a, b) => b.price - a.price);
    if (sortBy === "rating") items = [...items].sort((a, b) => b.rating - a.rating);
    if (sortBy === "reviews") items = [...items].sort((a, b) => b.reviewCount - a.reviewCount);
    return items;
  }, [category, priceRange, sortBy]);

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="static" color="primary" elevation={1}>
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700 }}>
            TechStore <Typography component="span" variant="caption">(drifted)</Typography>
          </Typography>
          <IconButton color="inherit" aria-label="search">
            <Search />
          </IconButton>
          <CartCounter badgeContent={cartCount} color="error">
            <IconButton color="inherit" aria-label="cart">
              <ShoppingCart />
            </IconButton>
          </CartCounter>
        </Toolbar>
      </AppBar>

      <Box sx={{ p: 3 }}>
        <Grid container spacing={3}>
          {/* Sidebar */}
          <Grid item xs={12} md={3}>
            <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                <FilterList fontSize="small" />
                <Typography variant="subtitle1" fontWeight={600}>
                  Filters
                </Typography>
              </Stack>

              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                CATEGORY
              </Typography>
              <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 3 }}>
                {CATEGORIES.map((cat) => (
                  <LabelChip
                    key={cat}
                    label={cat}
                    size="small"
                    color={category === cat ? "primary" : "default"}
                    variant={category === cat ? "filled" : "outlined"}
                    onClick={category !== cat ? () => setCategory(cat) : undefined}
                    onDelete={category === cat && cat !== "All" ? () => setCategory("All") : undefined}
                  />
                ))}
              </Stack>

              <Divider sx={{ mb: 2 }} />

              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                PRICE RANGE
              </Typography>
              <PriceSlider
                value={priceRange}
                onChange={setPriceRange}
                min={0}
                max={2000}
                step={50}
              />
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="caption">${priceRange[0]}</Typography>
                <Typography variant="caption">${priceRange[1]}</Typography>
              </Stack>
            </Box>
          </Grid>

          {/* Product grid */}
          <Grid item xs={12} md={9}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ mb: 2 }}
            >
              <Typography variant="body2" color="text.secondary">
                {filtered.length} product{filtered.length !== 1 ? "s" : ""}
              </Typography>
              <SortDropdown
                value={sortBy}
                onChange={setSortBy}
                label="Sort by"
              />
            </Stack>

            <Grid container spacing={2}>
              {filtered.map((product) => (
                <Grid item xs={12} sm={6} lg={4} key={product.id}>
                  <SimpleProductCard product={product} onAddToCart={() => setCartCount((c) => c + 1)} />
                </Grid>
              ))}
            </Grid>
          </Grid>
        </Grid>
      </Box>
    </Box>
  );
}
