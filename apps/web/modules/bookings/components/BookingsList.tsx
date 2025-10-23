"use client";

import type { Row, Table as ReactTable } from "@tanstack/react-table";

import { DataTableWrapper, DataTableFilters, DataTableSegment } from "@calcom/features/data-table";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { EmptyScreen } from "@calcom/ui/components/empty-screen";

import SkeletonLoader from "@components/booking/SkeletonLoader";

import type { RowData, BookingListingStatus } from "../types";

const descriptionByStatus: Record<BookingListingStatus, string> = {
  upcoming: "upcoming_bookings",
  recurring: "recurring_bookings",
  past: "past_bookings",
  cancelled: "cancelled_bookings",
  unconfirmed: "unconfirmed_bookings",
};

type BookingsListViewProps = {
  status: BookingListingStatus;
  table: ReactTable<RowData>;
  isPending: boolean;
  totalRowCount?: number;
  onRowClick?: (row: Row<RowData>) => void;
};

export function BookingsList({ status, table, isPending, totalRowCount, onRowClick }: BookingsListViewProps) {
  const { t } = useLocale();

  return (
    <DataTableWrapper
      className="mb-6"
      table={table}
      testId={`${status}-bookings`}
      bodyTestId="bookings"
      isPending={isPending}
      totalRowCount={totalRowCount}
      variant="default"
      paginationMode="standard"
      onRowMouseclick={onRowClick}
      rowClassName={(row) => {
        const isSeparatorRow = row.original.type !== "data";

        // Style separator rows to look like table headers
        if (isSeparatorRow) {
          // Add border-t for separation, except for the first row (index 0)
          const isFirstRow = row.index === 0;
          return isFirstRow ? "!bg-muted" : "!bg-muted border-subtle border-t";
        }

        // For data rows, check if the next row is a separator row
        const allRows = table.getRowModel().rows;
        const nextRow = allRows[row.index + 1];
        const isNextRowSeparator = nextRow?.original.type !== "data";

        // Remove bottom border from data rows that precede separator rows to avoid double borders
        if (isNextRowSeparator) {
          return "!border-b-0";
        }

        return "";
      }}
      ToolbarLeft={
        <>
          <DataTableFilters.FilterBar table={table} />
        </>
      }
      ToolbarRight={
        <>
          <DataTableFilters.ClearFiltersButton />
          <DataTableSegment.SaveButton />
          <DataTableSegment.Select />
        </>
      }
      LoaderView={<SkeletonLoader />}
      EmptyView={
        <div className="flex items-center justify-center pt-2 xl:pt-0">
          <EmptyScreen
            Icon="calendar"
            headline={t("no_status_bookings_yet", { status: t(status).toLowerCase() })}
            description={t("no_status_bookings_yet_description", {
              status: t(status).toLowerCase(),
              description: t(descriptionByStatus[status]),
            })}
          />
        </div>
      }
    />
  );
}
