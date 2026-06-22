import { useState } from "react";
import {
  Tile,
  Tag,
  Button,
  IconButton,
  OverflowMenu,
  OverflowMenuItem,
  AspectRatio,
  Grid,
  Column,
  Stack,
} from "@carbon/react";
import {
  ShoppingCart,
  Bookmark,
  BookmarkFilled,
  StarFilled,
  Star,
} from "@carbon/icons-react";

interface Product {
  name: string;
  category: string;
  description: string;
  price: number;
  originalPrice: number;
  rating: number;
  reviewCount: number;
  tag: { label: string; type: "red" | "green" | "blue" | "purple" };
  imageBg: string;
}

const product: Product = {
  name: "Wireless Headphones Pro",
  category: "Audio",
  description:
    "Premium noise-cancelling headphones with 40-hour battery life and spatial audio support.",
  price: 149.99,
  originalPrice: 199.99,
  rating: 4.5,
  reviewCount: 128,
  tag: { label: "Sale", type: "red" },
  imageBg: "linear-gradient(135deg, #0f62fe 0%, #4589ff 100%)",
};

function StarRating({ value, reviewCount }: { value: number; reviewCount: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
      {Array.from({ length: 5 }, (_, i) =>
        i < Math.floor(value) ? (
          <StarFilled key={i} size={14} style={{ color: "#f1c21b" }} />
        ) : (
          <Star key={i} size={14} style={{ color: "#8d8d8d" }} />
        )
      )}
      <span style={{ marginLeft: 4, fontSize: 12, color: "#6f6f6f" }}>
        {value} ({reviewCount})
      </span>
    </div>
  );
}

function SaveButton() {
  const [saved, setSaved] = useState(false);
  return (
    <IconButton
      label={saved ? "Remove from wishlist" : "Save to wishlist"}
      kind="ghost"
      size="sm"
      onClick={() => setSaved(!saved)}
    >
      {saved ? <BookmarkFilled /> : <Bookmark />}
    </IconButton>
  );
}

// ── Variant 1: Compact ───────────────────────────────────────────────────────
// Dense grid card. Minimal text, icon-only CTA. Works well at small column widths.

function CompactCard({ p }: { p: Product }) {
  return (
    <Tile style={{ padding: 0, overflow: "hidden" }}>
      <AspectRatio ratio="4x3">
        <div style={{ background: p.imageBg, width: "100%", height: "100%" }} />
      </AspectRatio>

      <div style={{ padding: "1rem" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "0.75rem",
          }}
        >
          <Tag type={p.tag.type} size="sm">
            {p.tag.label}
          </Tag>
          <SaveButton />
        </div>

        <p
          className="cds--productive-heading-02"
          style={{ marginBottom: "0.25rem" }}
        >
          {p.name}
        </p>
        <p style={{ fontSize: 12, color: "#6f6f6f", marginBottom: "1rem" }}>
          {p.category}
        </p>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <span style={{ fontSize: 18, fontWeight: 600 }}>${p.price}</span>
            <span
              style={{
                fontSize: 12,
                color: "#6f6f6f",
                textDecoration: "line-through",
                marginLeft: 6,
              }}
            >
              ${p.originalPrice}
            </span>
          </div>
          <Button
            size="sm"
            renderIcon={ShoppingCart}
            iconDescription="Add to cart"
            hasIconOnly
            kind="primary"
          />
        </div>
      </div>
    </Tile>
  );
}

// ── Variant 2: Standard ──────────────────────────────────────────────────────
// Default product card. Full detail — description, star rating, overflow menu,
// and two CTAs. Suited for featured or search result grids.

function StandardCard({ p }: { p: Product }) {
  return (
    <Tile style={{ padding: 0, overflow: "hidden" }}>
      <AspectRatio ratio="16x9">
        <div style={{ background: p.imageBg, width: "100%", height: "100%" }} />
      </AspectRatio>

      <div style={{ padding: "1rem" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "0.75rem",
          }}
        >
          <Tag type={p.tag.type}>{p.tag.label}</Tag>
          <div style={{ display: "flex", alignItems: "center" }}>
            <SaveButton />
            <OverflowMenu aria-label="More options" size="sm">
              <OverflowMenuItem itemText="Compare" />
              <OverflowMenuItem itemText="Share" />
              <OverflowMenuItem itemText="Report listing" hasDivider isDelete />
            </OverflowMenu>
          </div>
        </div>

        <p
          className="cds--productive-heading-03"
          style={{ marginBottom: "0.25rem" }}
        >
          {p.name}
        </p>
        <p style={{ fontSize: 12, color: "#6f6f6f", marginBottom: "0.5rem" }}>
          {p.category}
        </p>
        <p
          style={{
            fontSize: 14,
            color: "#393939",
            lineHeight: 1.5,
            marginBottom: "0.75rem",
          }}
        >
          {p.description}
        </p>

        <StarRating value={p.rating} reviewCount={p.reviewCount} />

        <div
          style={{ margin: "1rem 0", borderTop: "1px solid #e0e0e0" }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "1rem",
          }}
        >
          <div>
            <span style={{ fontSize: 22, fontWeight: 600 }}>${p.price}</span>
            <span
              style={{
                fontSize: 12,
                color: "#6f6f6f",
                textDecoration: "line-through",
                marginLeft: 8,
              }}
            >
              ${p.originalPrice}
            </span>
          </div>
          <Tag type="green" size="sm">
            In stock
          </Tag>
        </div>

        <Stack gap={3}>
          <Button renderIcon={ShoppingCart} style={{ width: "100%" }}>
            Add to cart
          </Button>
          <Button kind="ghost" style={{ width: "100%" }}>
            View details
          </Button>
        </Stack>
      </div>
    </Tile>
  );
}

// ── Variant 3: Horizontal ────────────────────────────────────────────────────
// List-view card. Image anchored left, metadata in the centre column,
// price and CTA pinned to the right. Works at full-width list layouts.

function HorizontalCard({ p }: { p: Product }) {
  return (
    <Tile style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", height: 168 }}>
        <div
          style={{
            width: 200,
            flexShrink: 0,
            background: p.imageBg,
          }}
        />

        <div
          style={{
            display: "flex",
            flex: 1,
            padding: "1rem 1.25rem",
            justifyContent: "space-between",
            gap: "1.5rem",
            overflow: "hidden",
          }}
        >
          {/* centre: meta */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{ display: "flex", gap: 6, marginBottom: "0.5rem" }}
            >
              <Tag type={p.tag.type} size="sm">
                {p.tag.label}
              </Tag>
              <Tag type="green" size="sm">
                In stock
              </Tag>
            </div>
            <p
              className="cds--productive-heading-03"
              style={{
                marginBottom: "0.2rem",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {p.name}
            </p>
            <p
              style={{ fontSize: 12, color: "#6f6f6f", marginBottom: "0.4rem" }}
            >
              {p.category}
            </p>
            <p
              style={{
                fontSize: 13,
                color: "#393939",
                lineHeight: 1.4,
                marginBottom: "0.6rem",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {p.description}
            </p>
            <StarRating value={p.rating} reviewCount={p.reviewCount} />
          </div>

          {/* right: price + actions */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              justifyContent: "space-between",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center" }}>
              <SaveButton />
              <OverflowMenu aria-label="More options" size="sm">
                <OverflowMenuItem itemText="Compare" />
                <OverflowMenuItem itemText="Share" />
              </OverflowMenu>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 22, fontWeight: 600 }}>${p.price}</div>
              <div
                style={{
                  fontSize: 12,
                  color: "#6f6f6f",
                  textDecoration: "line-through",
                  marginBottom: "0.5rem",
                }}
              >
                ${p.originalPrice}
              </div>
              <Button size="sm" renderIcon={ShoppingCart}>
                Add to cart
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Tile>
  );
}

// ── Scene ────────────────────────────────────────────────────────────────────

export function ProductCardsScenario() {
  return (
    <Stack gap={7}>
      <p style={{ fontSize: 13, color: "#6f6f6f", maxWidth: 560 }}>
        Three layout variants of the same product. Compact for dense grids,
        Standard for featured displays, Horizontal for list views.
      </p>

      <Grid>
        <Column lg={4} md={4} sm={4}>
          <p
            style={{
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#6f6f6f",
              marginBottom: "0.75rem",
            }}
          >
            Variant 1 — Compact
          </p>
          <CompactCard p={product} />
        </Column>

        <Column lg={5} md={4} sm={4}>
          <p
            style={{
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#6f6f6f",
              marginBottom: "0.75rem",
            }}
          >
            Variant 2 — Standard
          </p>
          <StandardCard p={product} />
        </Column>

        <Column lg={16} md={8} sm={4}>
          <p
            style={{
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#6f6f6f",
              marginBottom: "0.75rem",
              marginTop: "2rem",
            }}
          >
            Variant 3 — Horizontal
          </p>
          <HorizontalCard p={product} />
        </Column>
      </Grid>
    </Stack>
  );
}
