/* eslint-disable @typescript-eslint/no-unused-vars */
import prisma from "@calcom/prisma";
import { MembershipRole } from "@calcom/prisma/enums";

type AccessibleUsersType = {
  memberUserIds: number[];
  adminUserId: number;
};

const getAllOrganizationMemberships = async (
  memberships: {
    userId: number;
    role: MembershipRole;
    teamId: number;
  }[],
  orgId: number
) => {
  return memberships.reduce<number[]>((acc, membership) => {
    if (membership.teamId === orgId) {
      acc.push(membership.userId);
    }
    return acc;
  }, []);
};

const getAllAdminMemberships = async (userId: number) => {
  return await prisma.membership.findMany({
    where: {
      userId: userId,
      accepted: true,
      role: { in: [MembershipRole.OWNER, MembershipRole.ADMIN] },
    },
    select: {
      team: {
        select: {
          id: true,
          isOrganization: true,
        },
      },
    },
  });
};

const getAllOrganizationMembers = async (organizationId: number) => {
  return await prisma.membership.findMany({
    where: {
      teamId: organizationId,
      accepted: true,
    },
    select: {
      userId: true,
    },
  });
};

export const getAccessibleUsers = async ({
  memberUserIds,
  adminUserId,
}: AccessibleUsersType): Promise<number[]> => {
  const adminOrgMembership = await prisma.membership.findFirst({
    where: {
      userId: adminUserId,
      accepted: true,
      role: { in: [MembershipRole.OWNER, MembershipRole.ADMIN] },
      team: {
        isOrganization: true,
      },
    },
    select: {
      teamId: true,
    },
  });

  if (!adminOrgMembership) return [];

  const orgId = adminOrgMembership.teamId;

  if (memberUserIds.length === 0) return [];

  const memberships = await prisma.membership.findMany({
    where: {
      teamId: orgId,
      userId: { in: memberUserIds },
      accepted: true,
    },
    select: {
      userId: true,
    },
  });

  return memberships.map((m) => m.userId);
};

export const retrieveOrgScopedAccessibleUsers = async ({ adminId }: { adminId: number }) => {
  const adminOrgMembership = await prisma.membership.findFirst({
    where: {
      userId: adminId,
      accepted: true,
      role: { in: [MembershipRole.OWNER, MembershipRole.ADMIN] },
      team: {
        isOrganization: true,
      },
    },
    select: {
      teamId: true,
    },
  });

  if (!adminOrgMembership) return [];

  const organizationId = adminOrgMembership.teamId;

  const allMemberships = await prisma.membership.findMany({
    where: {
      teamId: organizationId,
      accepted: true,
    },
    select: {
      userId: true,
    },
  });

  return allMemberships.map((membership) => membership.userId);
};
