"use client";

import type { Row } from "@tanstack/react-table";
import { useReactTable, getCoreRowModel, getSortedRowModel, createColumnHelper } from "@tanstack/react-table";
import { usePathname } from "next/navigation";
import { createParser, useQueryState } from "nuqs";
import { useMemo, useState, useCallback } from "react";

import { getPaymentAppData } from "@calcom/app-store/_utils/payments/getPaymentAppData";
import dayjs from "@calcom/dayjs";
import {
  DataTableProvider,
  type SystemFilterSegment,
  useDataTable,
  ColumnFilterType,
  useFilterValue,
  ZMultiSelectFilterValue,
  ZDateRangeFilterValue,
  ZTextFilterValue,
} from "@calcom/features/data-table";
import { useSegments } from "@calcom/features/data-table/hooks/useSegments";
import { MeetingSessionDetailsDialog } from "@calcom/features/ee/video/MeetingSessionDetailsDialog";
import ViewRecordingsDialog from "@calcom/features/ee/video/ViewRecordingsDialog";
import { getPlaceholderAvatar } from "@calcom/lib/defaultAvatarImage";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { BookingStatus } from "@calcom/prisma/enums";
import { trpc } from "@calcom/trpc/react";
import useMeQuery from "@calcom/trpc/react/hooks/useMeQuery";
import { Alert } from "@calcom/ui/components/alert";
import { AvatarGroup } from "@calcom/ui/components/avatar";
import { Badge } from "@calcom/ui/components/badge";
import { Button } from "@calcom/ui/components/button";
import {
  Dropdown,
  DropdownItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuPortal,
} from "@calcom/ui/components/dropdown";
import { TableActions } from "@calcom/ui/components/table";
import type { ActionType } from "@calcom/ui/components/table";
import { showToast } from "@calcom/ui/components/toast";
import { WipeMyCalActionButton } from "@calcom/web/components/apps/wipemycalother/wipeMyCalActionButton";

import {
  getPendingActions,
  getCancelEventAction,
  getEditEventActions,
  getAfterEventActions,
  getReportAction,
  shouldShowPendingActions,
  shouldShowEditActions,
  shouldShowRecurringCancelAction,
  shouldShowIndividualReportButton,
  type BookingActionContext,
} from "@components/booking/bookingActions";
import { AddGuestsDialog } from "@components/dialog/AddGuestsDialog";
import { ChargeCardDialog } from "@components/dialog/ChargeCardDialog";
import { EditLocationDialog } from "@components/dialog/EditLocationDialog";
import { ReassignDialog } from "@components/dialog/ReassignDialog";
import { ReportBookingDialog } from "@components/dialog/ReportBookingDialog";
import { RerouteDialog } from "@components/dialog/RerouteDialog";
import { RescheduleDialog } from "@components/dialog/RescheduleDialog";

import { useFacetedUniqueValues } from "~/bookings/hooks/useFacetedUniqueValues";
import type { validStatuses } from "~/bookings/lib/validStatuses";

import { BookingDetailsSheet } from "../components/BookingDetailsSheet";
import { BookingsCalendar } from "../components/BookingsCalendar";
import { BookingsList } from "../components/BookingsList";
import type { RowData, BookingOutput } from "../types";

type BookingsProps = {
  status: (typeof validStatuses)[number];
  userId?: number;
  permissions: {
    canReadOthersBookings: boolean;
  };
};

function useSystemSegments(userId?: number) {
  const { t } = useLocale();

  const systemSegments: SystemFilterSegment[] = useMemo(() => {
    if (!userId) return [];

    return [
      {
        id: "my_bookings",
        name: t("my_bookings"),
        type: "system",
        activeFilters: [
          {
            f: "userId",
            v: {
              type: ColumnFilterType.MULTI_SELECT,
              data: [userId],
            },
          },
        ],
        perPage: 10,
      },
    ];
  }, [userId, t]);

  return systemSegments;
}

export default function Bookings(props: BookingsProps) {
  const pathname = usePathname();
  const systemSegments = useSystemSegments(props.userId);
  if (!pathname) return null;
  return (
    <DataTableProvider tableIdentifier={pathname} useSegments={useSegments} systemSegments={systemSegments}>
      <BookingsContent {...props} />
    </DataTableProvider>
  );
}

const viewParser = createParser({
  parse: (value: string) => {
    if (value === "calendar") return "calendar";
    return "list";
  },
  serialize: (value: "list" | "calendar") => value,
});

function BookingsContent({ status, permissions }: BookingsProps) {
  const [view] = useQueryState("view", viewParser.withDefault("list"));
  const { t } = useLocale();
  const user = useMeQuery().data;
  const utils = trpc.useUtils();
  const [selectedBooking, setSelectedBooking] = useState<BookingOutput | null>(null);
  const [selectedBookingForActions, setSelectedBookingForActions] = useState<BookingOutput | null>(null);

  // Dialog states for actions
  const [isOpenRescheduleDialog, setIsOpenRescheduleDialog] = useState(false);
  const [isOpenReassignDialog, setIsOpenReassignDialog] = useState(false);
  const [isOpenSetLocationDialog, setIsOpenLocationDialog] = useState(false);
  const [isOpenAddGuestsDialog, setIsOpenAddGuestsDialog] = useState(false);
  const [isOpenReportDialog, setIsOpenReportDialog] = useState(false);
  const [rerouteDialogIsOpen, setRerouteDialogIsOpen] = useState(false);
  const [chargeCardDialogIsOpen, setChargeCardDialogIsOpen] = useState(false);
  const [viewRecordingsDialogIsOpen, setViewRecordingsDialogIsOpen] = useState<boolean>(false);
  const [meetingSessionDetailsDialogIsOpen, setMeetingSessionDetailsDialogIsOpen] = useState<boolean>(false);

  const eventTypeIds = useFilterValue("eventTypeId", ZMultiSelectFilterValue)?.data as number[] | undefined;
  const teamIds = useFilterValue("teamId", ZMultiSelectFilterValue)?.data as number[] | undefined;
  const userIds = useFilterValue("userId", ZMultiSelectFilterValue)?.data as number[] | undefined;
  const dateRange = useFilterValue("dateRange", ZDateRangeFilterValue)?.data;
  const attendeeName = useFilterValue("attendeeName", ZTextFilterValue);
  const attendeeEmail = useFilterValue("attendeeEmail", ZTextFilterValue);
  const bookingUid = useFilterValue("bookingUid", ZTextFilterValue)?.data?.operand as string | undefined;

  const { limit, offset } = useDataTable();

  const query = trpc.viewer.bookings.get.useQuery({
    limit,
    offset,
    filters: {
      status,
      eventTypeIds,
      teamIds,
      userIds,
      attendeeName,
      attendeeEmail,
      bookingUid,
      afterStartDate: dateRange?.startDate
        ? dayjs(dateRange?.startDate).startOf("day").toISOString()
        : undefined,
      beforeEndDate: dateRange?.endDate ? dayjs(dateRange?.endDate).endOf("day").toISOString() : undefined,
    },
  });

  const noShowMutation = trpc.viewer.loggedInViewerRouter.markNoShow.useMutation({
    onSuccess: async (data) => {
      showToast(data.message, "success");
      await utils.viewer.bookings.invalidate();
    },
    onError: (err) => {
      showToast(err.message, "error");
    },
  });

  const setLocationMutation = trpc.viewer.bookings.editLocation.useMutation({
    onSuccess: () => {
      showToast(t("location_updated"), "success");
      setIsOpenLocationDialog(false);
      utils.viewer.bookings.invalidate();
    },
    onError: (e) => {
      const errorMessages: Record<string, string> = {
        UNAUTHORIZED: t("you_are_unauthorized_to_make_this_change_to_the_booking"),
        BAD_REQUEST: e.message,
      };
      const message = errorMessages[e.data?.code as string] || t("location_update_failed");
      showToast(message, "error");
    },
  });

  const saveLocation = async ({
    newLocation,
    credentialId,
  }: {
    newLocation: string;
    credentialId: number | null;
  }) => {
    if (!selectedBookingForActions) return;
    try {
      await setLocationMutation.mutateAsync({
        bookingId: selectedBookingForActions.id,
        newLocation,
        credentialId,
      });
    } catch {
      // Errors are shown through the mutation onError handler
    }
  };

  // Helper function to build BookingActionContext
  const buildBookingActionContext = useCallback(
    (booking: BookingOutput): BookingActionContext => {
      const isUpcoming = new Date(booking.endTime) >= new Date();
      const isBookingInPast = new Date(booking.endTime) < new Date();
      const isCancelled = booking.status === BookingStatus.CANCELLED;
      const isConfirmed = booking.status === BookingStatus.ACCEPTED;
      const isRejected = booking.status === BookingStatus.REJECTED;
      const isPending = booking.status === BookingStatus.PENDING;
      const isRecurring = booking.recurringEventId !== null;
      const isTabRecurring = status === "recurring";
      const isTabUnconfirmed = status === "unconfirmed";

      const userSeat = booking.seatsReferences.find(
        (seat) => !!user?.email && seat.attendee?.email === user.email
      );
      const isAttendee = !!userSeat;

      const paymentAppData = getPaymentAppData(booking.eventType);

      const attendeeList = booking.attendees.map((attendee) => ({
        name: attendee.name,
        email: attendee.email,
        id: attendee.id,
        noShow: attendee.noShow || false,
        phoneNumber: attendee.phoneNumber,
      }));

      const getSeatReferenceUid = () => userSeat?.referenceUid;

      const isCalVideoLocation =
        !booking.location ||
        booking.location === "integrations:daily" ||
        (typeof booking.location === "string" && booking.location.trim() === "");

      const isBookingFromRoutingForm = !!booking.routedFromRoutingFormReponse && !!booking.eventType?.team;

      return {
        booking: booking as unknown as BookingActionContext["booking"],
        isUpcoming,
        isOngoing: isUpcoming && new Date() >= new Date(booking.startTime),
        isBookingInPast,
        isCancelled,
        isConfirmed,
        isRejected,
        isPending,
        isRescheduled: booking.fromReschedule !== null,
        isRecurring,
        isTabRecurring,
        isTabUnconfirmed,
        isBookingFromRoutingForm,
        isDisabledCancelling: booking.eventType.disableCancelling || false,
        isDisabledRescheduling: booking.eventType.disableRescheduling || false,
        isCalVideoLocation,
        showPendingPayment: paymentAppData.enabled && booking.payment.length > 0 && !booking.paid,
        isAttendee,
        cardCharged: booking.payment[0]?.success || false,
        attendeeList,
        getSeatReferenceUid,
        t,
      };
    },
    [status, user?.email, t]
  );

  const columns = useMemo(() => {
    const columnHelper = createColumnHelper<RowData>();

    return [
      columnHelper.accessor((row) => row.type === "data" && row.booking.eventType.id, {
        id: "eventTypeId",
        header: t("event_type"),
        enableColumnFilter: true,
        enableSorting: false,
        cell: () => null,
        meta: {
          filter: {
            type: ColumnFilterType.MULTI_SELECT,
          },
        },
      }),
      columnHelper.accessor((row) => row.type === "data" && row.booking.eventType.team?.id, {
        id: "teamId",
        header: t("team"),
        enableColumnFilter: true,
        enableSorting: false,
        cell: () => null,
        meta: {
          filter: {
            type: ColumnFilterType.MULTI_SELECT,
          },
        },
      }),
      columnHelper.accessor((row) => row.type === "data" && row.booking.user?.id, {
        id: "userId",
        header: t("member"),
        enableColumnFilter: permissions.canReadOthersBookings,
        enableSorting: false,
        cell: () => null,
        meta: {
          filter: {
            type: ColumnFilterType.MULTI_SELECT,
          },
        },
      }),
      columnHelper.accessor((row) => row, {
        id: "attendeeName",
        header: t("attendee_name"),
        enableColumnFilter: true,
        enableSorting: false,
        cell: () => null,
        meta: {
          filter: {
            type: ColumnFilterType.TEXT,
          },
        },
      }),
      columnHelper.accessor((row) => row, {
        id: "attendeeEmail",
        header: t("attendee_email_variable"),
        enableColumnFilter: true,
        enableSorting: false,
        cell: () => null,
        meta: {
          filter: {
            type: ColumnFilterType.TEXT,
          },
        },
      }),
      columnHelper.accessor((row) => row, {
        id: "dateRange",
        header: t("date_range"),
        enableColumnFilter: true,
        enableSorting: false,
        cell: () => null,
        meta: {
          filter: {
            type: ColumnFilterType.DATE_RANGE,
            dateRangeOptions: {
              range: status === "past" ? "past" : "custom",
            },
          },
        },
      }),
      columnHelper.accessor((row) => row.type === "data" && row.booking.uid, {
        id: "bookingUid",
        header: t("booking_uid"),
        enableColumnFilter: true,
        enableSorting: false,
        cell: () => null,
        meta: {
          filter: {
            type: ColumnFilterType.TEXT,
            textOptions: {
              allowedOperators: ["equals"],
            },
          },
        },
      }),
      columnHelper.display({
        id: "date",
        header: () => <span className="text-subtle text-sm font-medium">{t("date")}</span>,
        cell: (props) => {
          const row = props.row.original;

          if (row.type === "data") {
            return (
              <div className="text-default text-sm font-medium">
                {dayjs(row.booking.startTime).tz(user?.timeZone).format("ddd, DD MMM")}
              </div>
            );
          }

          // Separator row - render label in first column with header-like styling
          const label = row.label || "";
          return <div className="text-default truncate text-sm font-medium leading-none">{label}</div>;
        },
      }),
      columnHelper.display({
        id: "time",
        header: () => <span className="text-subtle text-sm font-medium">{t("time")}</span>,
        cell: (props) => {
          const row = props.row.original;

          // Only render for data rows, return null for separator rows
          if (row.type !== "data") return null;

          const startTime = dayjs(row.booking.startTime).tz(user?.timeZone);
          const endTime = dayjs(row.booking.endTime).tz(user?.timeZone);
          return (
            <div className="text-default text-sm font-medium">
              {startTime.format(user?.timeFormat === 12 ? "h:mma" : "HH:mm")} -{" "}
              {endTime.format(user?.timeFormat === 12 ? "h:mma" : "HH:mm")}
            </div>
          );
        },
      }),
      columnHelper.display({
        id: "event",
        header: () => <span className="text-subtle text-sm font-medium">{t("event")}</span>,
        cell: (props) => {
          const row = props.row.original;
          if (row.type !== "data") return null;

          return <div className="text-emphasis flex-1 truncate text-sm font-medium">{row.booking.title}</div>;
        },
      }),
      columnHelper.display({
        id: "who",
        header: () => <span className="text-subtle text-sm font-medium">{t("who")}</span>,
        cell: (props) => {
          const row = props.row.original;
          if (row.type !== "data") return null;

          const items = row.booking.attendees.map((attendee) => ({
            image: getPlaceholderAvatar(null, attendee.name),
            alt: attendee.name,
            title: attendee.name,
            href: null,
          }));

          return <AvatarGroup size="sm" truncateAfter={4} items={items} />;
        },
      }),
      columnHelper.display({
        id: "team",
        header: () => <span className="text-subtle text-sm font-medium">{t("team")}</span>,
        cell: (props) => {
          const row = props.row.original;
          if (row.type !== "data") return null;

          if (row.booking.eventType.team) {
            return (
              <Badge variant="gray" size="sm">
                {row.booking.eventType.team.name}
              </Badge>
            );
          }
          return null;
        },
      }),
      columnHelper.display({
        id: "actions",
        header: () => null,
        cell: (props) => {
          const row = props.row.original;
          if (row.type !== "data") return null;

          const booking = row.booking;
          const actionContext = buildBookingActionContext(booking);

          // Find video conference reference for today's bookings only
          const videoReference = row.isToday
            ? booking.references?.find((ref) => ref.type.includes("_video"))
            : undefined;
          const meetingUrl = videoReference?.meetingUrl;

          // Determine the platform name for the button label
          let platformName = "Meeting";
          if (videoReference) {
            if (videoReference.type.includes("zoom")) {
              platformName = "Zoom";
            } else if (videoReference.type.includes("google_meet")) {
              platformName = "Google Meet";
            } else if (videoReference.type.includes("teams")) {
              platformName = "Teams";
            }
          }

          // Build actions
          const basePendingActions = getPendingActions(actionContext);
          const pendingActions: ActionType[] = basePendingActions.map((action) => ({
            ...action,
            onClick: (e: React.MouseEvent) => {
              e.stopPropagation();
              setSelectedBookingForActions(booking);
              // Handle pending actions - these would need their own handlers
            },
          })) as ActionType[];

          const baseEditEventActions = getEditEventActions(actionContext);
          const editEventActions: ActionType[] = baseEditEventActions.map((action) => ({
            ...action,
            onClick: (e: React.MouseEvent) => {
              e.stopPropagation();
              setSelectedBookingForActions(booking);
              if (action.id === "reschedule_request") {
                setIsOpenRescheduleDialog(true);
              } else if (action.id === "reroute") {
                setRerouteDialogIsOpen(true);
              } else if (action.id === "change_location") {
                setIsOpenLocationDialog(true);
              } else if (action.id === "add_members") {
                setIsOpenAddGuestsDialog(true);
              } else if (action.id === "reassign") {
                setIsOpenReassignDialog(true);
              }
            },
          })) as ActionType[];

          const baseAfterEventActions = getAfterEventActions(actionContext);
          const afterEventActions: ActionType[] = baseAfterEventActions.map((action) => ({
            ...action,
            onClick: (e: React.MouseEvent) => {
              e.stopPropagation();
              setSelectedBookingForActions(booking);
              if (action.id === "view_recordings") {
                setViewRecordingsDialogIsOpen(true);
              } else if (action.id === "meeting_session_details") {
                setMeetingSessionDetailsDialogIsOpen(true);
              } else if (action.id === "charge_card") {
                setChargeCardDialogIsOpen(true);
              } else if (action.id === "no_show") {
                if (actionContext.attendeeList.length === 1) {
                  const attendee = actionContext.attendeeList[0];
                  noShowMutation.mutate({
                    bookingUid: booking.uid,
                    attendees: [{ email: attendee.email, noShow: !attendee.noShow }],
                  });
                }
              }
            },
          })) as ActionType[];

          const cancelEventAction = getCancelEventAction(actionContext);
          const reportAction = getReportAction(actionContext);
          const reportActionWithHandler = {
            ...reportAction,
            onClick: (e: React.MouseEvent) => {
              e.stopPropagation();
              setSelectedBookingForActions(booking);
              setIsOpenReportDialog(true);
            },
          };

          const isRejected = booking.status === BookingStatus.REJECTED;

          return (
            <div className="flex w-full items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
              {meetingUrl && (
                <Button
                  variant="button"
                  color="secondary"
                  href={meetingUrl}
                  target="_blank"
                  rel="noopener noreferrer">
                  {t("join_platform", { platform: platformName })}
                </Button>
              )}
              {shouldShowPendingActions(actionContext) && <TableActions actions={pendingActions} />}
              {shouldShowEditActions(actionContext) && (
                <Dropdown>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      color="secondary"
                      variant="icon"
                      StartIcon="ellipsis"
                      data-testid="booking-actions-dropdown"
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuContent>
                      <DropdownMenuLabel className="px-2 pb-1 pt-1.5">{t("edit_event")}</DropdownMenuLabel>
                      {editEventActions.map((action) => (
                        <DropdownMenuItem className="rounded-lg" key={action.id} disabled={action.disabled}>
                          <DropdownItem
                            type="button"
                            color={action.color}
                            StartIcon={action.icon}
                            href={action.href}
                            disabled={action.disabled}
                            onClick={action.onClick}
                            data-bookingid={action.bookingId}
                            data-testid={action.id}
                            className={action.disabled ? "text-muted" : undefined}>
                            {action.label}
                          </DropdownItem>
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="px-2 pb-1 pt-1.5">{t("after_event")}</DropdownMenuLabel>
                      {afterEventActions.map((action) => (
                        <DropdownMenuItem className="rounded-lg" key={action.id} disabled={action.disabled}>
                          <DropdownItem
                            type="button"
                            color={action.color}
                            StartIcon={action.icon}
                            href={action.href}
                            onClick={action.onClick}
                            disabled={action.disabled}
                            data-bookingid={action.bookingId}
                            data-testid={action.id}
                            className={action.disabled ? "text-muted" : undefined}>
                            {action.label}
                          </DropdownItem>
                        </DropdownMenuItem>
                      ))}
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="rounded-lg"
                          key={reportActionWithHandler.id}
                          disabled={reportActionWithHandler.disabled}>
                          <DropdownItem
                            type="button"
                            color={reportActionWithHandler.color}
                            StartIcon={reportActionWithHandler.icon}
                            onClick={reportActionWithHandler.onClick}
                            disabled={reportActionWithHandler.disabled}
                            data-testid={reportActionWithHandler.id}
                            className={reportActionWithHandler.disabled ? "text-muted" : undefined}>
                            {reportActionWithHandler.label}
                          </DropdownItem>
                        </DropdownMenuItem>
                      </>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="rounded-lg"
                        key={cancelEventAction.id}
                        disabled={cancelEventAction.disabled}>
                        <DropdownItem
                          type="button"
                          color={cancelEventAction.color}
                          StartIcon={cancelEventAction.icon}
                          href={cancelEventAction.disabled ? undefined : cancelEventAction.href}
                          onClick={cancelEventAction.onClick}
                          disabled={cancelEventAction.disabled}
                          data-bookingid={cancelEventAction.bookingId}
                          data-testid={cancelEventAction.id}
                          className={cancelEventAction.disabled ? "text-muted" : undefined}>
                          {cancelEventAction.label}
                        </DropdownItem>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenuPortal>
                </Dropdown>
              )}
              {shouldShowRecurringCancelAction(actionContext) && (
                <TableActions actions={[cancelEventAction]} />
              )}
              {shouldShowIndividualReportButton(actionContext) && (
                <div className="flex items-center space-x-2">
                  <Button
                    type="button"
                    variant="icon"
                    color="destructive"
                    StartIcon={reportActionWithHandler.icon}
                    onClick={reportActionWithHandler.onClick}
                    disabled={reportActionWithHandler.disabled}
                    data-testid={reportActionWithHandler.id}
                    className="h-8 w-8"
                    tooltip={reportActionWithHandler.label}
                  />
                </div>
              )}
              {isRejected && <div className="text-subtle text-sm">{t("rejected")}</div>}
            </div>
          );
        },
      }),
    ];
  }, [
    user,
    status,
    t,
    permissions.canReadOthersBookings,
    buildBookingActionContext,
    noShowMutation,
    setSelectedBookingForActions,
    setIsOpenRescheduleDialog,
    setRerouteDialogIsOpen,
    setIsOpenLocationDialog,
    setIsOpenAddGuestsDialog,
    setIsOpenReassignDialog,
    setViewRecordingsDialogIsOpen,
    setMeetingSessionDetailsDialogIsOpen,
    setChargeCardDialogIsOpen,
    setIsOpenReportDialog,
  ]);

  const isEmpty = useMemo(() => !query.data?.bookings.length, [query.data]);

  const groupedBookings = useMemo(() => {
    if (!query.data?.bookings) {
      return { today: [], currentMonth: [], monthBuckets: {} };
    }

    const now = dayjs().tz(user?.timeZone);
    const today = now.format("YYYY-MM-DD");
    const currentMonthStart = now.startOf("month");
    const currentMonthEnd = now.endOf("month");

    const shownBookings: Record<string, BookingOutput[]> = {};
    const filterBookings = (booking: BookingOutput) => {
      if (status === "recurring" || status == "unconfirmed" || status === "cancelled") {
        if (!booking.recurringEventId) {
          return true;
        }
        if (
          shownBookings[booking.recurringEventId] !== undefined &&
          shownBookings[booking.recurringEventId].length > 0
        ) {
          shownBookings[booking.recurringEventId].push(booking);
          return false;
        }
        shownBookings[booking.recurringEventId] = [booking];
      }
      return true;
    };

    const todayBookings: RowData[] = [];
    const currentMonthBookings: RowData[] = [];
    const monthBuckets: Record<string, RowData[]> = {}; // Key format: "YYYY-MM"

    query.data.bookings.filter(filterBookings).forEach((booking) => {
      const bookingDate = dayjs(booking.startTime).tz(user?.timeZone);
      const bookingDateStr = bookingDate.format("YYYY-MM-DD");
      const monthKey = bookingDate.format("YYYY-MM");

      const rowData: RowData = {
        type: "data",
        booking,
        isToday: bookingDateStr === today,
        recurringInfo: query.data?.recurringInfo.find(
          (info) => info.recurringEventId === booking.recurringEventId
        ),
      };

      if (bookingDateStr === today) {
        todayBookings.push(rowData);
      } else if (bookingDate.isAfter(currentMonthStart) && bookingDate.isBefore(currentMonthEnd)) {
        currentMonthBookings.push(rowData);
      } else if (bookingDate.isAfter(currentMonthEnd)) {
        if (!monthBuckets[monthKey]) {
          monthBuckets[monthKey] = [];
        }
        monthBuckets[monthKey].push(rowData);
      }
    });

    return { today: todayBookings, currentMonth: currentMonthBookings, monthBuckets };
  }, [query.data, status, user?.timeZone]);

  const flatData = useMemo<RowData[]>(() => {
    return [...groupedBookings.currentMonth, ...Object.values(groupedBookings.monthBuckets).flat()];
  }, [groupedBookings]);

  const bookingsToday = useMemo<RowData[]>(() => {
    return groupedBookings.today;
  }, [groupedBookings]);

  const finalData = useMemo<RowData[]>(() => {
    if (status !== "upcoming") {
      return flatData;
    }

    const merged: RowData[] = [];

    // Add Today section
    if (groupedBookings.today.length > 0) {
      merged.push({ type: "separator", label: t("today") }, ...groupedBookings.today);
    }

    // Add Current Month section (rest of this month, excluding today)
    if (groupedBookings.currentMonth.length > 0) {
      merged.push({ type: "separator", label: t("this_month") }, ...groupedBookings.currentMonth);
    }

    // Add individual month sections
    const sortedMonthKeys = Object.keys(groupedBookings.monthBuckets).sort();
    sortedMonthKeys.forEach((monthKey) => {
      const bookings = groupedBookings.monthBuckets[monthKey];
      if (bookings.length > 0) {
        const monthLabel = dayjs(monthKey, "YYYY-MM").format("MMMM YYYY");
        merged.push({ type: "separator", label: monthLabel }, ...bookings);
      }
    });

    return merged;
  }, [groupedBookings, status, t, flatData]);

  const getFacetedUniqueValues = useFacetedUniqueValues();

  const table = useReactTable<RowData>({
    data: finalData,
    columns,
    initialState: {
      columnVisibility: {
        eventTypeId: false,
        teamId: false,
        userId: false,
        attendeeName: false,
        attendeeEmail: false,
        dateRange: false,
        bookingUid: false,
        date: true,
        time: true,
        event: true,
        who: true,
        team: true,
        actions: true,
      },
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedUniqueValues,
  });

  const isPending = query.isPending;
  const totalRowCount = query.data?.totalCount;

  const handleRowClick = (row: Row<RowData>) => {
    // Only open details sheet for data rows
    if (row.original.type === "data") {
      setSelectedBooking(row.original.booking);
    }
  };

  // Calculate navigation state for booking details sheet
  const bookingNavigation = useMemo(() => {
    if (!selectedBooking) {
      return { hasPrevious: false, hasNext: false, onPrevious: undefined, onNext: undefined };
    }

    // Get all data rows (exclude separator rows)
    const dataRows = finalData.filter(
      (row): row is Extract<RowData, { type: "data" }> => row.type === "data"
    );

    // Find current booking index
    const currentIndex = dataRows.findIndex((row) => row.booking.id === selectedBooking.id);

    if (currentIndex === -1) {
      return { hasPrevious: false, hasNext: false, onPrevious: undefined, onNext: undefined };
    }

    const hasPrevious = currentIndex > 0;
    const hasNext = currentIndex < dataRows.length - 1;

    const onPrevious = hasPrevious
      ? () => {
          setSelectedBooking(dataRows[currentIndex - 1].booking);
        }
      : undefined;

    const onNext = hasNext
      ? () => {
          setSelectedBooking(dataRows[currentIndex + 1].booking);
        }
      : undefined;

    return { hasPrevious, hasNext, onPrevious, onNext };
  }, [selectedBooking, finalData]);

  const getBookingStatus = (booking: BookingOutput): "upcoming" | "past" | "cancelled" | "rejected" => {
    const isCancelled = booking.status === BookingStatus.CANCELLED;
    const isRejected = booking.status === BookingStatus.REJECTED;
    const isBookingInPast = new Date(booking.endTime) < new Date();
    if (isCancelled) return "cancelled";
    if (isRejected) return "rejected";
    if (isBookingInPast) return "past";
    return "upcoming";
  };

  return (
    <div className="flex flex-col">
      <RescheduleDialog
        isOpenDialog={isOpenRescheduleDialog}
        setIsOpenDialog={setIsOpenRescheduleDialog}
        bookingUId={selectedBookingForActions?.uid || ""}
      />
      {isOpenReassignDialog && selectedBookingForActions && (
        <ReassignDialog
          isOpenDialog={isOpenReassignDialog}
          setIsOpenDialog={setIsOpenReassignDialog}
          bookingId={selectedBookingForActions.id}
          teamId={selectedBookingForActions.eventType?.team?.id || 0}
          bookingFromRoutingForm={
            !!selectedBookingForActions.routedFromRoutingFormReponse &&
            !!selectedBookingForActions.eventType?.team
          }
        />
      )}
      {selectedBookingForActions && (
        <>
          <EditLocationDialog
            booking={selectedBookingForActions as BookingActionContext["booking"]}
            saveLocation={saveLocation}
            isOpenDialog={isOpenSetLocationDialog}
            setShowLocationModal={setIsOpenLocationDialog}
            teamId={selectedBookingForActions.eventType?.team?.id}
          />
          <AddGuestsDialog
            isOpenDialog={isOpenAddGuestsDialog}
            setIsOpenDialog={setIsOpenAddGuestsDialog}
            bookingId={selectedBookingForActions.id}
          />
          <ReportBookingDialog
            isOpenDialog={isOpenReportDialog}
            setIsOpenDialog={setIsOpenReportDialog}
            bookingUid={selectedBookingForActions.uid}
            isRecurring={selectedBookingForActions.recurringEventId !== null}
            status={getBookingStatus(selectedBookingForActions)}
          />
          {selectedBookingForActions.paid && selectedBookingForActions.payment[0] && (
            <ChargeCardDialog
              isOpenDialog={chargeCardDialogIsOpen}
              setIsOpenDialog={setChargeCardDialogIsOpen}
              bookingId={selectedBookingForActions.id}
              paymentAmount={selectedBookingForActions.payment[0].amount}
              paymentCurrency={selectedBookingForActions.payment[0].currency}
            />
          )}
          {(selectedBookingForActions.location === "integrations:daily" ||
            !selectedBookingForActions.location ||
            (typeof selectedBookingForActions.location === "string" &&
              selectedBookingForActions.location.trim() === "")) && (
            <>
              <ViewRecordingsDialog
                booking={selectedBookingForActions as BookingActionContext["booking"]}
                isOpenDialog={viewRecordingsDialogIsOpen}
                setIsOpenDialog={setViewRecordingsDialogIsOpen}
                timeFormat={user?.timeFormat ?? null}
              />
              {meetingSessionDetailsDialogIsOpen && (
                <MeetingSessionDetailsDialog
                  booking={selectedBookingForActions as BookingActionContext["booking"]}
                  isOpenDialog={meetingSessionDetailsDialogIsOpen}
                  setIsOpenDialog={setMeetingSessionDetailsDialogIsOpen}
                  timeFormat={user?.timeFormat ?? null}
                />
              )}
            </>
          )}
          {selectedBookingForActions.routedFromRoutingFormReponse &&
            selectedBookingForActions.eventType?.team && (
              <RerouteDialog
                isOpenDialog={rerouteDialogIsOpen}
                setIsOpenDialog={setRerouteDialogIsOpen}
                booking={
                  {
                    ...selectedBookingForActions,
                    startTime: selectedBookingForActions.startTime.toString(),
                  } as unknown as Parameters<typeof RerouteDialog>[0]["booking"]
                }
              />
            )}
        </>
      )}
      <main className="w-full">
        <div className="flex w-full flex-col">
          {query.status === "error" && (
            <Alert severity="error" title={t("something_went_wrong")} message={query.error.message} />
          )}
          {query.status !== "error" && (
            <>
              {!!bookingsToday.length && status === "upcoming" && (
                <WipeMyCalActionButton bookingStatus={status} bookingsEmpty={isEmpty} />
              )}
              {view === "list" ? (
                <BookingsList
                  status={status}
                  table={table}
                  isPending={isPending}
                  totalRowCount={totalRowCount}
                  onRowClick={handleRowClick}
                />
              ) : (
                <BookingsCalendar status={status} table={table} />
              )}
            </>
          )}
        </div>
      </main>

      <BookingDetailsSheet
        booking={selectedBooking}
        isOpen={!!selectedBooking}
        onClose={() => setSelectedBooking(null)}
        userTimeZone={user?.timeZone}
        userTimeFormat={user?.timeFormat === null ? undefined : user?.timeFormat}
        onPrevious={bookingNavigation.onPrevious}
        hasPrevious={bookingNavigation.hasPrevious}
        onNext={bookingNavigation.onNext}
        hasNext={bookingNavigation.hasNext}
      />
    </div>
  );
}
