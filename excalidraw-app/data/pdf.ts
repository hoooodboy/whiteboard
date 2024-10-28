import axios from "axios";
// import pdfImgConvert from "pdf-img-convert-web";

const readFileDataUrl = (file: File): Promise<string | ArrayBuffer | null> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      if (e.target) {
        resolve(e.target.result);
      }
    };

    reader.onerror = (e) => {
      reject(e.target?.error);
    };

    reader.readAsDataURL(file);
  });
};

export const readImage = (
  url: string,
): Promise<{ width: number; height: number } | null> => {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = (e) => {
      resolve({ width: img.width, height: img.height });
    };

    img.onerror = (e) => {
      reject(null);
    };

    img.src = url;
  });
};

export const readFile = (file: File): Promise<Uint8Array | string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      if (e.target) {
        const buffer = e.target.result as ArrayBuffer;
        const uint8Array = new Uint8Array(buffer);
        resolve(uint8Array);
      }
    };

    reader.onerror = (e) => {
      reject(e.target?.error);
    };

    reader.readAsArrayBuffer(file);
  });
};

export const getPdf2pngServer = async (file: File) => {
  const fileContentBase64 = await readFileDataUrl(file);
  if (!fileContentBase64 || typeof fileContentBase64 != "string") {
    throw new Error("fileContentBase64 is undefined");
  }
  const [, base64] = fileContentBase64.split(",");
  const imageUrlToDataUrl: (imageUrl: string) => Promise<string> = (
    imageUrl: string,
  ) => {
    return fetch(imageUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Network response was not ok");
        }
        return response.blob();
      })
      .then((blob) => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            if (typeof reader.result == "string") {
              resolve(reader.result);
            } else {
              reject(null);
            }
          };
          reader.onerror = () => {
            reject(null);
          };
          reader.readAsDataURL(blob);
        });
      });
  };

  // const imageUrlToDataUrlUseImage: (imageUrl: string) => Promise<string> = (
  //   imageUrl: string,
  // ) => {
  //   return new Promise((resolve, reject) => {
  //     const img = new Image();
  //     img.crossOrigin = "Anonymous";
  //     img.src = imageUrl;
  //     img.onload = () => {
  //       const canvas: HTMLCanvasElement = document.createElement("canvas");
  //       const ctx = canvas.getContext("2d");
  //       canvas.width = img.width;
  //       canvas.height = img.height;
  //       ctx?.drawImage(img, 0, 0);
  //       const dataUrl = canvas.toDataURL("image/png");
  //       resolve(dataUrl);
  //     };
  //     img.onerror = (error) => {
  //       reject(error);
  //     };
  //   });
  // };

  const response = await axios.post(
    `${import.meta.env.VITE_APP_PDF_SERVER_URL}/api/convert/create`,
    {
      pdf: base64,
      ext: "jpg",
      resolution: "150",
      firstPage: "0",
      lastPage: "0",
    },
  );
  const imagesUrls = response.data;
  const tasks: Promise<string>[] = new Array<Promise<string>>();
  for (const imageUrl of imagesUrls) {
    tasks.push(imageUrlToDataUrl(imageUrl));
  }
  return await Promise.all(tasks);
};

// export const getPdf2pngClient = async (file: File) => {
//   const fileContent = await readFile(file);
//   const images = await pdfImgConvert.convert(fileContent, {
//     base64: true,
//     rotate: 0,
//     scale: 1.5,
//   });
//   return images;
// };
