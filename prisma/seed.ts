import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PORTLAND_SPACES = [
  // Original seed
  {
    name: "Corner Storefront on Alberta",
    address: "1234 NE Alberta St",
    neighborhood: "Alberta Arts District",
    city: "Portland, OR",
    squareFeet: 900,
    zoningCode: "CM2",
    previousUse: "Coffee shop",
    lat: 45.5588,
    lng: -122.6496,
  },
  {
    name: "Vacant Lot near Division",
    address: "4100 SE Division St",
    neighborhood: "Richmond",
    city: "Portland, OR",
    squareFeet: 5000,
    zoningCode: "CM1",
    previousUse: "Surface parking",
    lat: 45.5057,
    lng: -122.6191,
  },
  {
    name: "Former Retail Bay on Mississippi",
    address: "3800 N Mississippi Ave",
    neighborhood: "Boise",
    city: "Portland, OR",
    squareFeet: 1200,
    zoningCode: "CM3",
    previousUse: "Boutique retail",
    lat: 45.5494,
    lng: -122.6752,
  },
  {
    name: "Empty Storefront on Hawthorne",
    address: "3500 SE Hawthorne Blvd",
    neighborhood: "Hawthorne",
    city: "Portland, OR",
    squareFeet: 1800,
    zoningCode: "CM2",
    previousUse: "Bookstore",
    lat: 45.5123,
    lng: -122.6212,
  },
  {
    name: "Lot on N Williams",
    address: "2900 N Williams Ave",
    neighborhood: "Boise",
    city: "Portland, OR",
    squareFeet: 3500,
    zoningCode: "CM3",
    previousUse: "Auto repair",
    lat: 45.5489,
    lng: -122.6681,
  },
  // From city distressed/vacant lists and commercial listings (SW Market, downtown)
  {
    name: "1541 SW Market St (distressed)",
    address: "1541 SW Market St",
    neighborhood: "Downtown",
    city: "Portland, OR",
    squareFeet: 2625,
    zoningCode: "CX",
    previousUse: "Medical / dental offices",
    lat: 45.5115,
    lng: -122.688,
  },
  {
    name: "1025 SW Market St",
    address: "1025 SW Market St",
    neighborhood: "Downtown",
    city: "Portland, OR",
    squareFeet: 10957,
    zoningCode: "CX",
    previousUse: "Office / religious",
    lat: 45.5128,
    lng: -122.682,
  },
  {
    name: "1814 SW Market St",
    address: "1814 SW Market St",
    neighborhood: "Southwest Portland",
    city: "Portland, OR",
    squareFeet: 3200,
    zoningCode: "CX",
    previousUse: "Commercial",
    lat: 45.5095,
    lng: -122.692,
  },
  // SE Martin Luther King Jr Blvd
  {
    name: "437 SE Martin Luther King Jr Blvd",
    address: "437 SE Martin Luther King Jr Blvd",
    neighborhood: "Buckman",
    city: "Portland, OR",
    squareFeet: 1100,
    zoningCode: "CM2",
    previousUse: "Flex space",
    lat: 45.5085,
    lng: -122.661,
  },
  {
    name: "550 SE Martin Luther King Jr Blvd (Jute)",
    address: "550 SE Martin Luther King Jr Blvd",
    neighborhood: "Buckman",
    city: "Portland, OR",
    squareFeet: 2500,
    zoningCode: "CM2",
    previousUse: "Retail",
    lat: 45.5092,
    lng: -122.66,
  },
  {
    name: "Gardeners & Ranchers Building",
    address: "1305 SE Martin Luther King Jr Blvd",
    neighborhood: "Buckman",
    city: "Portland, OR",
    squareFeet: 1500,
    zoningCode: "CM2",
    previousUse: "Flex space",
    lat: 45.5045,
    lng: -122.655,
  },
  // NE Broadway
  {
    name: "Landmark Building on Broadway",
    address: "628 NE Broadway St",
    neighborhood: "Irvington",
    city: "Portland, OR",
    squareFeet: 14600,
    zoningCode: "CM2",
    previousUse: "Retail / office",
    lat: 45.5355,
    lng: -122.661,
  },
  // SE Division / 28th corridor
  {
    name: "Storefront on SE Division",
    address: "2828 SE Division St",
    neighborhood: "Richmond",
    city: "Portland, OR",
    squareFeet: 1400,
    zoningCode: "CM2",
    previousUse: "Retail",
    lat: 45.5042,
    lng: -122.639,
  },
  // Old Town
  {
    name: "Old Town storefront",
    address: "300 NW Everett St",
    neighborhood: "Old Town Chinatown",
    city: "Portland, OR",
    squareFeet: 2200,
    zoningCode: "CX",
    previousUse: "Retail",
    lat: 45.5252,
    lng: -122.676,
  },
  // N Portland
  {
    name: "N Lombard retail bay",
    address: "7600 N Lombard St",
    neighborhood: "St. Johns",
    city: "Portland, OR",
    squareFeet: 2800,
    zoningCode: "CM1",
    previousUse: "Retail",
    lat: 45.583,
    lng: -122.754,
  },
  {
    name: "Killingsworth storefront",
    address: "2100 NE Killingsworth St",
    neighborhood: "Concordia",
    city: "Portland, OR",
    squareFeet: 1100,
    zoningCode: "CM2",
    previousUse: "Cafe",
    lat: 45.5582,
    lng: -122.644,
  },
  {
    name: "SE Stark retail",
    address: "3200 SE Stark St",
    neighborhood: "Richmond",
    city: "Portland, OR",
    squareFeet: 1600,
    zoningCode: "CM2",
    previousUse: "Restaurant",
    lat: 45.5195,
    lng: -122.632,
  },
];

async function main() {
  let created = 0;
  for (const s of PORTLAND_SPACES) {
    const existing = await prisma.space.findFirst({
      where: { address: s.address, city: s.city },
    });
    if (!existing) {
      await prisma.space.create({ data: s });
      created++;
    }
  }
  console.log("Seed: " + created + " new Portland space(s) added (" + PORTLAND_SPACES.length + " total in seed list).");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
