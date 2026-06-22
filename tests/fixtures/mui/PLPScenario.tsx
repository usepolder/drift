import { useState, useMemo } from "react";
import {
  AppBar,
  Toolbar,
  Typography,
  Box,
  Grid,
  Card,
  CardMedia,
  CardContent,
  CardActions,
  Button,
  Chip,
  Rating,
  Slider,
  Badge,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  IconButton,
  Divider,
  Stack,
  Tooltip,
} from "@mui/material";
import {
  ShoppingCart,
  Favorite,
  FavoriteBorder,
  Search,
  FilterList,
} from "@mui/icons-material";
import { PRODUCTS, CATEGORIES, SORT_OPTIONS, type Product } from "../data/products";

export function PLPScenario() {
  const [category, setCategory] = useState("All");
  const [priceRange, setPriceRange] = useState<number[]>([0, 2000]);
  const [sortBy, setSortBy] = useState("featured");
  const [cartCount, setCartCount] = useState(3);
  const [wishlist, setWishlist] = useState<Set<string>>(new Set());

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

  const toggleWishlist = (id: string) => {
    setWishlist((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="static" color="primary" elevation={1}>
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700 }}>
            TechStore
          </Typography>
          <IconButton color="inherit" aria-label="search">
            <Search />
          </IconButton>
          <Badge badgeContent={cartCount} color="error" sx={{ ml: 1 }}>
            <IconButton color="inherit" aria-label="cart">
              <ShoppingCart />
            </IconButton>
          </Badge>
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
                  <Chip
                    key={cat}
                    label={cat}
                    size="small"
                    color={category === cat ? "primary" : "default"}
                    variant={category === cat ? "filled" : "outlined"}
                    onClick={() => setCategory(cat)}
                    clickable
                  />
                ))}
              </Stack>

              <Divider sx={{ mb: 2 }} />

              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                PRICE RANGE
              </Typography>
              <Box sx={{ px: 1 }}>
                <Slider
                  value={priceRange}
                  onChange={(_, val) => setPriceRange(val as number[])}
                  min={0}
                  max={2000}
                  step={50}
                  valueLabelDisplay="auto"
                  valueLabelFormat={(v) => `$${v}`}
                />
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="caption">${priceRange[0]}</Typography>
                  <Typography variant="caption">${priceRange[1]}</Typography>
                </Stack>
              </Box>
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
              <FormControl size="small" sx={{ minWidth: 180 }}>
                <InputLabel>Sort by</InputLabel>
                <Select
                  value={sortBy}
                  label="Sort by"
                  onChange={(e) => setSortBy(e.target.value)}
                >
                  {SORT_OPTIONS.map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>

            <Grid container spacing={2}>
              {filtered.map((product) => (
                <Grid item xs={12} sm={6} lg={4} key={product.id}>
                  <ProductCard
                    product={product}
                    wishlisted={wishlist.has(product.id)}
                    onWishlist={() => toggleWishlist(product.id)}
                    onAddToCart={() => setCartCount((n) => n + 1)}
                  />
                </Grid>
              ))}
            </Grid>
          </Grid>
        </Grid>
      </Box>
    </Box>
  );
}

interface ProductCardProps {
  product: Product;
  wishlisted: boolean;
  onWishlist: () => void;
  onAddToCart: () => void;
}

function ProductCard({ product, wishlisted, onWishlist, onAddToCart }: ProductCardProps) {
  return (
    <Card
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        opacity: product.inStock ? 1 : 0.6,
      }}
    >
      <Box sx={{ position: "relative" }}>
        <CardMedia
          component="img"
          height="180"
          image={product.image}
          alt={product.name}
        />
        {product.originalPrice && (
          <Chip
            label={`-${Math.round((1 - product.price / product.originalPrice) * 100)}%`}
            color="error"
            size="small"
            sx={{ position: "absolute", top: 8, left: 8 }}
          />
        )}
        <Tooltip title={wishlisted ? "Remove from wishlist" : "Add to wishlist"}>
          <IconButton
            size="small"
            onClick={onWishlist}
            sx={{ position: "absolute", top: 4, right: 4, bgcolor: "background.paper" }}
            aria-label="wishlist"
          >
            {wishlisted ? <Favorite color="error" fontSize="small" /> : <FavoriteBorder fontSize="small" />}
          </IconButton>
        </Tooltip>
        {!product.inStock && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "rgba(0,0,0,0.35)",
            }}
          >
            <Chip label="Out of Stock" color="default" />
          </Box>
        )}
      </Box>

      <CardContent sx={{ flexGrow: 1, pb: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {product.brand}
        </Typography>
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.5, lineHeight: 1.3 }}>
          {product.name}
        </Typography>
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1 }}>
          <Rating value={product.rating} precision={0.1} size="small" readOnly />
          <Typography variant="caption" color="text.secondary">
            ({product.reviewCount.toLocaleString()})
          </Typography>
        </Stack>
        <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mb: 1 }}>
          {product.tags.map((tag) => (
            <Chip key={tag} label={tag} size="small" variant="outlined" />
          ))}
        </Stack>
        <Stack direction="row" alignItems="baseline" spacing={1}>
          <Typography variant="h6" fontWeight={700}>
            ${product.price}
          </Typography>
          {product.originalPrice && (
            <Typography variant="body2" color="text.secondary" sx={{ textDecoration: "line-through" }}>
              ${product.originalPrice}
            </Typography>
          )}
        </Stack>
      </CardContent>

      <CardActions sx={{ px: 2, pb: 2 }}>
        <Button
          variant="contained"
          fullWidth
          size="small"
          disabled={!product.inStock}
          onClick={onAddToCart}
          startIcon={<ShoppingCart />}
        >
          {product.inStock ? "Add to Cart" : "Out of Stock"}
        </Button>
      </CardActions>
    </Card>
  );
}
